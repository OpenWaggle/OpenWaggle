import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { ThinkingLevel } from '@shared/types/settings'
import type { WaggleConfig } from '@shared/types/waggle'
import { FirstSendFailed, MessageNotDelivered } from '@/features/chat/lib'
import { createOptimisticUserMessage } from '@/features/chat/lib/useAgentChat.utils'
import { useBackgroundRunStore } from '@/features/chat/state/background-run-store'
import { useOptimisticUserMessageStore } from '@/features/chat/state/optimistic-user-message-store'
import { flushDraftWorktreePlanToSession } from '@/features/git'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('use-send-message')

interface SendMessageDeps {
  readonly activeSessionId: SessionId | null
  readonly projectPath: string | null
  readonly thinkingLevel: ThinkingLevel
  readonly createSession: (projectPath: string) => Promise<SessionId>
  readonly sendMessage: (payload: AgentSendPayload) => Promise<void>
  readonly sendMessageToSession: (
    sessionId: SessionId,
    payload: AgentSendPayload,
    config: WaggleConfig | null,
  ) => Promise<void>
  readonly sendWaggleMessage: (payload: AgentSendPayload, config: WaggleConfig) => Promise<void>
}

interface SendMessageHandlers {
  readonly handleSend: (payload: AgentSendPayload) => Promise<void>
  readonly handleSendText: (content: string) => Promise<void>
  readonly handleSendWaggle: (payload: AgentSendPayload, config: WaggleConfig) => Promise<void>
}

/** Pure factory — testable without React. */
export function createSendHandlers(deps: SendMessageDeps): SendMessageHandlers {
  const {
    activeSessionId,
    projectPath,
    thinkingLevel,
    createSession,
    sendMessage,
    sendMessageToSession,
    sendWaggleMessage,
  } = deps

  async function handleSend(payload: AgentSendPayload) {
    if (!activeSessionId) {
      if (!projectPath) {
        throw new Error('Select a project before sending.')
      }
      const sessionId = await createSession(projectPath)
      await flushDraftWorktreePlanToSession(projectPath, sessionId)
      /*
       * Awaited, and its failure propagates. Dispatching this fire-and-forget meant the caller was told
       * the send had succeeded: a review submitted as a session's first message was cleared and never
       * restored, because the promise that would have signalled the failure was dropped.
       */
      await sendMessageToSession(sessionId, payload, null)
      return
    }
    await sendMessage(payload)
  }

  async function handleSendText(content: string) {
    await handleSend({ text: content, thinkingLevel, attachments: [] })
  }

  async function handleSendWaggle(payload: AgentSendPayload, config: WaggleConfig) {
    if (!activeSessionId) {
      if (!projectPath) {
        throw new Error('Select a project before sending.')
      }
      const sessionId = await createSession(projectPath)
      await flushDraftWorktreePlanToSession(projectPath, sessionId)
      void sendMessageToSession(sessionId, payload, config)
      return
    }
    await sendWaggleMessage(payload, config)
  }

  return { handleSend, handleSendText, handleSendWaggle }
}

interface UseSendMessageOptions {
  readonly activeSessionId: SessionId | null
  readonly model: SupportedModelId
  readonly projectPath: string | null
  readonly thinkingLevel: ThinkingLevel
  readonly createSession: (projectPath: string) => Promise<SessionId>
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
    const optimisticUserMessage = createOptimisticUserMessage(payload)
    useOptimisticUserMessageStore.getState().add(sessionId, optimisticUserMessage)
    useBackgroundRunStore.getState().setRunRenderMessages(sessionId, [optimisticUserMessage])

    try {
      /*
       * The report is read, not just awaited. Main recovers every run failure into a value rather than
       * failing the Effect, so this invoke resolves whether the turn ran or was refused - an unresolvable
       * base ref, a foreign directory on the worktree path, a failed `worktree add`, an invalid model. There
       * was therefore no rejection for the caller to react to, and a review submitted as a session's first
       * message was cleared on a failure that looked exactly like success.
       */
      const report = config
        ? await api.sendWaggleMessage(sessionId, payload, model, config)
        : await api.sendMessage(sessionId, payload, model)
      if (report.outcome === 'delivered') return
      /*
       * A cancellation is reported too, so work the user may still want is not discarded - but it carries its
       * outcome, because a caller must not tell the user their turn "could not start" when they stopped it.
       */
      throw new MessageNotDelivered(report.outcome, report.message)
    } catch (error) {
      useBackgroundRunStore.getState().clearRunRenderSnapshot(sessionId)
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
  })
}
