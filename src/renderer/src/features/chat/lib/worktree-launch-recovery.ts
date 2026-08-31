import type { AgentSendReport } from '@shared/types/agent'
import type { WorktreeLaunchSnapshot } from '@shared/types/background-run'
import { SessionId, WagglePresetId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import type { WagglePreset } from '@shared/types/waggle'
import { useChatStore } from '@/features/chat/state/chat-store'
import { setEditorDraft } from '@/features/composer/lib'
import { useComposerStore } from '@/features/composer/state'
import { useWaggleStore } from '@/features/waggle/state'
import { api } from '@/shared/lib/ipc'
import { useBackgroundRunStore } from '../state/background-run-store'
import { useOptimisticUserMessageStore } from '../state/optimistic-user-message-store'

function recoveryFor(sessionId: SessionId) {
  return useBackgroundRunStore.getState().firstSendRecoveryBySessionId.get(sessionId) ?? null
}

function presetFromRecovery(
  recovery: NonNullable<ReturnType<typeof recoveryFor>>,
): WagglePreset | null {
  const invocation = recovery.payload.waggle
  if (!invocation) return null
  return {
    id: WagglePresetId(invocation.presetId),
    name: invocation.presetName,
    description: '',
    config: invocation.config,
    isBuiltIn: false,
    createdAt: 0,
    updatedAt: 0,
  }
}

function restoreFailedLaunch(
  sessionId: SessionId,
  previousLaunch: WorktreeLaunchSnapshot | null,
  errorMessage: string,
) {
  const now = Date.now()
  useBackgroundRunStore.getState().setWorktreeLaunch(sessionId, {
    status: 'failed',
    stage: previousLaunch?.stage ?? 'preparing-workspace',
    startedAt: previousLaunch?.startedAt ?? now,
    updatedAt: now,
    details: previousLaunch?.details ?? [],
    progressPercentage: previousLaunch?.progressPercentage,
    worktreePath: previousLaunch?.worktreePath,
    branch: previousLaunch?.branch,
    baseRef: previousLaunch?.baseRef,
    errorMessage,
  })
}

export async function retryFirstSend(sessionIdValue: string, workLocally = false) {
  const sessionId = SessionId(sessionIdValue)
  const recovery = recoveryFor(sessionId)
  if (!recovery) return
  const previousLaunch = useBackgroundRunStore.getState().getWorktreeLaunch(sessionId)

  if (workLocally) {
    await api.cancelAgent(sessionId)
    const requestId = crypto.randomUUID()
    const response = await api.mutateSessionControl({
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId,
      idempotencyKey: requestId,
      command: {
        operation: 'handoff',
        sessionId,
        workspace: { mode: 'local' },
      },
    })
    if (response.outcome.effect === 'rejected') {
      throw new Error(`Session handoff was rejected: ${response.outcome.code}`)
    }
  }

  if (recovery.waggleConfig) {
    useWaggleStore.getState().startCollaboration(sessionId, recovery.waggleConfig)
  }
  let report: AgentSendReport
  try {
    report = recovery.waggleConfig
      ? await api.sendWaggleMessage(
          sessionId,
          recovery.payload,
          recovery.model,
          recovery.waggleConfig,
        )
      : await api.sendMessage(sessionId, recovery.payload, recovery.model)
  } catch (error) {
    if (recovery.waggleConfig) useWaggleStore.getState().stopCollaboration(sessionId)
    restoreFailedLaunch(
      sessionId,
      previousLaunch,
      error instanceof Error ? error.message : String(error),
    )
    throw error
  }

  if (report.outcome === 'delivered') {
    if (useBackgroundRunStore.getState().getWorktreeLaunch(sessionId) === previousLaunch) {
      useBackgroundRunStore.getState().setWorktreeLaunch(sessionId, null)
    }
    // Session Host accepted the retry, but worktree birth and Pi execution are still asynchronous.
    // Terminal transcript reconciliation owns removal of the retained payload.
    return
  }
  if (recovery.waggleConfig) useWaggleStore.getState().stopCollaboration(sessionId)
  restoreFailedLaunch(
    sessionId,
    previousLaunch,
    'The first message was not delivered. Try again or work locally.',
  )
}

export async function cancelFirstSend(sessionIdValue: string) {
  const sessionId = SessionId(sessionIdValue)
  const recovery = recoveryFor(sessionId)
  const targetDraftContextKey = useComposerStore.getState().activeDraftContextKey
  await api.cancelAgent(sessionId)
  if (recovery) {
    const composer = useComposerStore.getState()
    const preset = presetFromRecovery(recovery)
    const recoveredDraft = {
      input: recovery.payload.text,
      attachments: recovery.payload.attachments,
      wagglePreset: preset,
    }
    const originStillActive =
      useChatStore.getState().activeSessionId === sessionId &&
      composer.activeDraftContextKey === targetDraftContextKey
    if (originStillActive) {
      composer.setInput(recoveredDraft.input)
      composer.replaceAttachments(recoveredDraft.attachments)
      composer.setSelectedWagglePreset(recoveredDraft.wagglePreset)
      if (composer.lexicalEditor) {
        setEditorDraft(composer.lexicalEditor, recoveredDraft.input, recoveredDraft.wagglePreset)
      }
    }
    if (!originStillActive && targetDraftContextKey) {
      composer.saveScopedDraft(targetDraftContextKey, recoveredDraft)
    }
  }
  useOptimisticUserMessageStore.getState().clear(sessionId)
  useBackgroundRunStore.getState().clearRunRenderSnapshot(sessionId)
  useBackgroundRunStore.getState().setWorktreeLaunch(sessionId, null)
  useBackgroundRunStore.getState().setFirstSendRecovery(sessionId, null)
  useWaggleStore.getState().stopCollaboration(sessionId)
}
