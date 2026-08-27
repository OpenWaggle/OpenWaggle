import type { AgentSendReport } from '@shared/types/agent'
import { SessionId, WagglePresetId } from '@shared/types/brand'
import type { WagglePreset } from '@shared/types/waggle'
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

export async function retryFirstSend(sessionIdValue: string, workLocally = false) {
  const sessionId = SessionId(sessionIdValue)
  const recovery = recoveryFor(sessionId)
  if (!recovery) return

  if (workLocally) {
    await api.cancelAgent(sessionId)
    await api.setSessionWorktreePlan(sessionId, {
      environmentMode: 'local',
      baseRef: null,
      startFromOrigin: false,
    })
  }

  useBackgroundRunStore.getState().setWorktreeLaunch(sessionId, null)
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
    throw error
  }

  if (report.outcome === 'delivered') {
    useBackgroundRunStore.getState().setFirstSendRecovery(sessionId, null)
    return
  }
  if (recovery.waggleConfig) useWaggleStore.getState().stopCollaboration(sessionId)
}

export async function cancelFirstSend(sessionIdValue: string) {
  const sessionId = SessionId(sessionIdValue)
  const recovery = recoveryFor(sessionId)
  await api.cancelAgent(sessionId)
  if (recovery) {
    const composer = useComposerStore.getState()
    const preset = presetFromRecovery(recovery)
    composer.setInput(recovery.payload.text)
    composer.replaceAttachments(recovery.payload.attachments)
    composer.setSelectedWagglePreset(preset)
    if (composer.lexicalEditor) {
      setEditorDraft(composer.lexicalEditor, recovery.payload.text, preset)
    }
  }
  useOptimisticUserMessageStore.getState().clear(sessionId)
  useBackgroundRunStore.getState().clearRunRenderSnapshot(sessionId)
  useBackgroundRunStore.getState().setWorktreeLaunch(sessionId, null)
  useBackgroundRunStore.getState().setFirstSendRecovery(sessionId, null)
  useWaggleStore.getState().stopCollaboration(sessionId)
}
