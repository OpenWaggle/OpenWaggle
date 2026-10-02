import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { SessionWorktreePlan } from '@shared/types/session'
import type { ThinkingLevel } from '@shared/types/settings'
import type { WaggleConfig } from '@shared/types/waggle'
import { FirstSendFailed, MessageNotDelivered } from '@/features/chat/lib'
import { createOptimisticUserMessage } from '@/features/chat/lib/useAgentChat.utils'
import { useBackgroundRunStore } from '@/features/chat/state/background-run-store'
import { useChatStore } from '@/features/chat/state/chat-store'
import { flushDraftAuthorizationModeToSession } from '@/features/chat/state/draft-authorization-mode-store'
import { lockDraftForFirstSend } from '@/features/chat/state/draft-first-send-lock'
import { useFirstSendPendingStore } from '@/features/chat/state/first-send-pending-store'
import { withForegroundSend } from '@/features/chat/state/foreground-send-store'
import { withInlineVisualizationContext } from '@/features/chat/state/inline-visualization-state'
import { useOptimisticUserMessageStore } from '@/features/chat/state/optimistic-user-message-store'
import { usePendingSendStore } from '@/features/chat/state/pending-send-store'
import { settledSessionSettingWrites } from '@/features/chat/state/session-setting-writes'
import {
  DEFAULT_THINKING_LEVEL_TARGET,
  draftThinkingLevel,
  settledThinkingLevelWrites,
} from '@/features/chat/state/session-thinking-level-writes'
import { snapshotDraftWorktreePlan } from '@/features/git'
import {
  selectDraftWorkspacePreparation,
  validateDraftWorkspacePreparation,
} from '@/features/project-actions'
import { useWaggleStore } from '@/features/waggle/state'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('use-send-message')

interface SendMessageDeps {
  readonly activeSessionId: SessionId | null
  readonly projectPath: string | null
  readonly createSession: (
    projectPath: string,
    worktreePlan?: SessionWorktreePlan,
    thinkingLevel?: ThinkingLevel,
  ) => Promise<SessionId>
  /** Pi's default thinking level as last read, which a draft shows without a pick; unknown: undefined. */
  readonly defaultThinkingLevel?: ThinkingLevel
  /**
   * Reads Pi's default as cached now, which a settled draft pick has refreshed. First send reads it
   * after the draft's picks settle; `defaultThinkingLevel` stands in when it reads nothing.
   */
  readonly readDefaultThinkingLevel?: () => ThinkingLevel | undefined
  readonly sendMessage: (payload: AgentSendPayload) => Promise<void>
  readonly sendMessageToSession: (
    sessionId: SessionId,
    payload: AgentSendPayload,
    config: WaggleConfig | null,
  ) => Promise<void>
  readonly sendWaggleMessage: (payload: AgentSendPayload, config: WaggleConfig) => Promise<void>
  readonly startWaggleCollaboration: (sessionId: SessionId, config: WaggleConfig) => void
}

interface SendMessageHandlers {
  readonly handleSend: (payload: AgentSendPayload) => Promise<void>
  readonly handleSendText: (content: string) => Promise<void>
  readonly handleSendWaggle: (payload: AgentSendPayload, config: WaggleConfig) => Promise<void>
}

function sessionWorktreePlan(
  snapshot: ReturnType<typeof snapshotDraftWorktreePlan>,
): SessionWorktreePlan | undefined {
  const environmentMode = snapshot?.plan.envMode
  if (!snapshot || !environmentMode) return undefined
  return {
    environmentMode,
    baseRef: snapshot.plan.baseRef ?? null,
    startFromOrigin: snapshot.plan.startFromOrigin ?? false,
  }
}

function firstSendFailure(error: unknown, sessionId: SessionId): FirstSendFailed {
  return error instanceof FirstSendFailed
    ? error
    : new FirstSendFailed(
        error instanceof Error ? error : new Error(String(error)),
        String(sessionId),
      )
}

/** Pure factory — testable without React. */
export function createSendHandlers(deps: SendMessageDeps): SendMessageHandlers {
  const {
    activeSessionId,
    projectPath,
    createSession,
    defaultThinkingLevel,
    readDefaultThinkingLevel,
    sendMessage,
    sendMessageToSession,
    sendWaggleMessage,
    startWaggleCollaboration,
  } = deps

  /**
   * Creates the draft's Session and prepares it, then hands it to `deliver` for its first Run.
   * From the moment the Session exists until that Run reports in, it counts as starting a Run, so
   * its settings stay locked and the Host never refuses a pick made in between.
   */
  async function sendFirstMessage(
    draftProjectPath: string,
    deliver: (sessionId: SessionId) => Promise<void>,
  ) {
    // Locked before the first await, so no pick lands after this send has started reading them.
    const releaseDraft = lockDraftForFirstSend(draftProjectPath)
    try {
      const worktreePlan = snapshotDraftWorktreePlan(draftProjectPath)
      const preparationProfileId =
        worktreePlan?.plan.envMode === 'worktree'
          ? await validateDraftWorkspacePreparation(
              draftProjectPath,
              worktreePlan.plan.preparationProfileId,
            )
          : null
      // A pick still being written to Pi's default lands first, so defaults change in pick order.
      await settledThinkingLevelWrites(DEFAULT_THINKING_LEVEL_TARGET)
      // Read only now: the draft shows a settled pick as the refreshed default, and a failed pick
      // as the default it left in place. The new Session starts at exactly that level, not at
      // whatever the default is when it is created, and the default is not written again for it.
      const thinkingLevel = draftThinkingLevel(readDefaultThinkingLevel?.() ?? defaultThinkingLevel)
      const sessionId = await createSession(
        draftProjectPath,
        sessionWorktreePlan(worktreePlan),
        thinkingLevel,
      )
      await withForegroundSend(sessionId, async () => {
        try {
          await flushDraftAuthorizationModeToSession(draftProjectPath, sessionId)
          if (preparationProfileId)
            await selectDraftWorkspacePreparation(draftProjectPath, sessionId, preparationProfileId)
        } catch (error) {
          throw firstSendFailure(error, sessionId)
        }
        await deliver(sessionId)
      })
    } finally {
      releaseDraft()
    }
  }

  async function handleSend(payload: AgentSendPayload) {
    if (!activeSessionId) {
      if (!projectPath) {
        throw new Error('Select a project before sending.')
      }
      /*
       * Awaited, and its failure propagates. Dispatching this fire-and-forget meant the caller was told
       * the send had succeeded: a review submitted as a session's first message was cleared and never
       * restored, because the promise that would have signalled the failure was dropped.
       */
      await sendFirstMessage(projectPath, (sessionId) =>
        sendMessageToSession(sessionId, payload, null),
      )
      return
    }
    await sendMessage(withInlineVisualizationContext(activeSessionId, payload))
  }

  async function handleSendText(content: string) {
    await handleSend({ text: content, attachments: [] })
  }

  async function handleSendWaggle(payload: AgentSendPayload, config: WaggleConfig) {
    if (!activeSessionId) {
      if (!projectPath) {
        throw new Error('Select a project before sending.')
      }
      /*
       * Awaited, and its failure propagates - the same reason the classic path does it. Dispatched
       * fire-and-forget the caller was told the send had succeeded, so a review submitted as a waggle session's
       * first message was cleared and never restored, and the rejection surfaced as an unhandled error instead
       * of reaching the caller that was holding the work.
       */
      await sendFirstMessage(projectPath, async (sessionId) => {
        startWaggleCollaboration(sessionId, config)
        await sendMessageToSession(sessionId, payload, config)
      })
      return
    }
    await sendWaggleMessage(withInlineVisualizationContext(activeSessionId, payload), config)
  }

  return { handleSend, handleSendText, handleSendWaggle }
}

interface UseSendMessageOptions {
  readonly activeSessionId: SessionId | null
  readonly model: SupportedModelId | undefined
  readonly projectPath: string | null
  readonly createSession: (
    projectPath: string,
    worktreePlan?: SessionWorktreePlan,
    thinkingLevel?: ThinkingLevel,
  ) => Promise<SessionId>
  /** Pi's default thinking level as last read (`defaultThinkingLevelQueryOptions`). */
  readonly defaultThinkingLevel?: ThinkingLevel
  /** Reads Pi's default from the query cache now; see `SendMessageDeps`. */
  readonly readDefaultThinkingLevel?: () => ThinkingLevel | undefined
  readonly sendMessage: (payload: AgentSendPayload) => Promise<void>
  readonly sendWaggleMessage: (payload: AgentSendPayload, config: WaggleConfig) => Promise<void>
}

/** Hook wrapper — binds first-message sends to the concrete created session id. */
export function useSendMessage(options: UseSendMessageOptions): SendMessageHandlers {
  const { activeSessionId, model, sendMessage, sendWaggleMessage, ...rest } = options

  async function sendMessageToSession(
    sessionId: SessionId,
    payload: AgentSendPayload,
    config: WaggleConfig | null,
  ) {
    const executionModel =
      useChatStore.getState().sessionById.get(sessionId)?.executionModel ?? model
    if (!executionModel) {
      throw new FirstSendFailed(
        new Error('Created Session has no execution model.'),
        String(sessionId),
      )
    }
    // The draft's pending send moves with it, so the new Session's transcript holds this message.
    usePendingSendStore.getState().adoptDraft(sessionId)
    const optimisticUserMessage = createOptimisticUserMessage(payload)
    useOptimisticUserMessageStore.getState().add(sessionId, optimisticUserMessage)
    useBackgroundRunStore.getState().setRunRenderMessages(sessionId, [optimisticUserMessage])
    useFirstSendPendingStore.getState().mark(sessionId)
    useBackgroundRunStore.getState().setFirstSendRecovery(sessionId, {
      payload,
      waggleConfig: config,
      model: executionModel,
    })

    try {
      // The Host starts the Run with the Session's model and thinking level: let any write land.
      await settledSessionSettingWrites(sessionId)
      /*
       * The report is read, not just awaited. Main recovers every run failure into a value rather than
       * failing the Effect, so this invoke resolves whether the turn ran or was refused - an unresolvable
       * base ref, a foreign directory on the worktree path, a failed `worktree add`, an invalid model. There
       * was therefore no rejection for the caller to react to, and a review submitted as a session's first
       * message was cleared on a failure that looked exactly like success.
       */
      const report = config
        ? await api.sendWaggleMessage(sessionId, payload, executionModel, config)
        : await api.sendMessage(sessionId, payload, executionModel)
      if (report.outcome === 'delivered') {
        /*
         * Session Host reports command acceptance before its supervised Run performs worktree birth or
         * reaches Pi. Keep the exact payload until terminal reconciliation sees durable transcript history;
         * otherwise an asynchronous launch failure leaves the recovery controls with nothing to replay.
         */
        return
      }
      if (report.outcome === 'queued') {
        /*
         * Kept as a Follow-up, not run: no Run will report back, so nothing may keep waiting for one. A
         * brand-new Session has no queue for this to join, but the contract allows it.
         */
        useFirstSendPendingStore.getState().clear(sessionId)
        useBackgroundRunStore.getState().setFirstSendRecovery(sessionId, null)
        useBackgroundRunStore.getState().clearRunRenderSnapshot(sessionId)
        useOptimisticUserMessageStore.getState().remove(sessionId, optimisticUserMessage.id)
        return
      }
      /*
       * A cancellation is reported too, so work the user may still want is not discarded - but it carries its
       * outcome, because a caller must not tell the user their turn "could not start" when they stopped it.
       */
      throw new MessageNotDelivered(report.outcome, report.message)
    } catch (error) {
      useFirstSendPendingStore.getState().clear(sessionId)
      if (config) useWaggleStore.getState().stopCollaboration(sessionId)
      if (error instanceof MessageNotDelivered && error.outcome === 'cancelled') {
        useBackgroundRunStore.getState().clearRunRenderSnapshot(sessionId)
      }
      logger.error('First message send failed', {
        sessionId: String(sessionId),
        error: error instanceof Error ? error.message : String(error),
      })
      /*
       * Rethrown so the caller can react - a submitted review has to be restored, not silently lost - and
       * named with the session just created, because that is where the caller's work now belongs and it
       * cannot be inferred reliably from the panel's own state.
       */
      throw new FirstSendFailed(
        error instanceof Error ? error : new Error(String(error)),
        String(sessionId),
      )
    }
  }

  return createSendHandlers({
    ...rest,
    activeSessionId,
    sendMessage,
    sendMessageToSession,
    sendWaggleMessage,
    startWaggleCollaboration: useWaggleStore.getState().startCollaboration,
  })
}
