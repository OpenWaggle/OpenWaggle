import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId, SupportedModelId } from '@shared/types/brand'
import type { WaggleCollaborationStatus, WaggleConfig } from '@shared/types/waggle'
import { useBranchSummaryStore } from '@/features/chat/state/branch-summary-store'
import { parseCompactCommand, parseSessionCopyCommand } from '@/features/composer/commands'
import { api } from '@/shared/lib/ipc'
import type { useBranchSummaryWorkflow } from './useBranchSummaryWorkflow'
import type { useSessionCopyWorkflow } from './useSessionCopyWorkflow'

interface ChatSendWorkflowParams {
  readonly activeSessionId: SessionId | null
  readonly branchSummary: ReturnType<typeof useBranchSummaryWorkflow>
  readonly clearDraftBranchForSession: (sessionId: SessionId) => void
  readonly draftBranch: Parameters<
    ReturnType<typeof useBranchSummaryWorkflow>['materializeDraftBranchForSend']
  >[0]
  readonly handleSend: (payload: AgentSendPayload) => Promise<void>
  readonly handleSendWaggle: (payload: AgentSendPayload, config: WaggleConfig) => Promise<void>
  readonly model: SupportedModelId
  readonly phase: { readonly reset: () => void }
  readonly refreshSession: (sessionId: SessionId) => Promise<void>
  readonly refreshSessionWorkspace: (sessionId: SessionId) => Promise<void>
  readonly sessionCopy: ReturnType<typeof useSessionCopyWorkflow>
  readonly setUserDidSend: (value: boolean) => void
  readonly setWaggleConfig: (config: WaggleConfig, sessionId: SessionId | null) => void
  readonly showToast: (message: string) => void
  readonly startWaggleCollaboration: (sessionId: SessionId, config: WaggleConfig) => void
  readonly stop: () => void
  readonly stopWaggleCollaboration: () => void
  readonly waggleConfig: WaggleConfig | null
  readonly waggleOwningId: SessionId | null
  readonly waggleStatus: WaggleCollaborationStatus
}

async function compactSession(params: ChatSendWorkflowParams, customInstructions?: string) {
  if (!params.activeSessionId) {
    params.showToast('Nothing to compact yet.')
    return
  }

  try {
    await api.compactSession(params.activeSessionId, params.model, customInstructions)
    await Promise.all([
      params.refreshSession(params.activeSessionId),
      params.refreshSessionWorkspace(params.activeSessionId),
    ])
  } catch (error) {
    params.showToast(error instanceof Error ? error.message : String(error))
  }
}

async function handleSendCommand(params: ChatSendWorkflowParams, text: string) {
  const branchSummaryPrompt = useBranchSummaryStore.getState().prompt
  if (branchSummaryPrompt?.mode === 'custom') {
    await params.branchSummary.materializeBranchSummary(text)
    return true
  }

  const compactCommand = parseCompactCommand(text)
  if (compactCommand) {
    await compactSession(params, compactCommand.customInstructions)
    return true
  }

  const sessionCopyCommand = parseSessionCopyCommand(text)
  if (sessionCopyCommand?.type === 'fork') {
    params.sessionCopy.openForkSelector()
    return true
  }
  if (sessionCopyCommand?.type === 'clone') {
    await params.sessionCopy.cloneCurrentSessionToNewSession()
    return true
  }
  return false
}

function activeWaggleConfigForSend(params: ChatSendWorkflowParams): WaggleConfig | null {
  if (!params.waggleConfig) return null
  if (params.waggleStatus !== 'idle') return null
  if (params.waggleOwningId && params.waggleOwningId !== params.activeSessionId) return null
  return params.waggleConfig
}

async function sendThroughActiveMode(params: ChatSendWorkflowParams, payload: AgentSendPayload) {
  const waggleConfig = activeWaggleConfigForSend(params)
  if (waggleConfig) {
    if (params.activeSessionId) {
      params.startWaggleCollaboration(params.activeSessionId, waggleConfig)
    }
    await params.handleSendWaggle(payload, waggleConfig)
    return
  }
  await params.handleSend(payload)
}

export function useChatSendWorkflow(params: ChatSendWorkflowParams) {
  return {
    async sendWithWaggle(payload: AgentSendPayload) {
      if (await handleSendCommand(params, payload.text)) return
      const draftBranchReady = await params.branchSummary.materializeDraftBranchForSend(
        params.draftBranch,
      )
      if (!draftBranchReady) return

      params.setUserDidSend(true)
      params.phase.reset()
      try {
        await sendThroughActiveMode(params, payload)
        if (params.activeSessionId) params.clearDraftBranchForSession(params.activeSessionId)
      } catch (error) {
        params.setUserDidSend(false)
        throw error
      }
    },
    cancelRun() {
      if (params.activeSessionId && params.waggleStatus !== 'idle') {
        api.cancelWaggle(params.activeSessionId)
        params.stopWaggleCollaboration()
      }
      params.stop()
    },
    startWaggle(config: WaggleConfig) {
      params.setWaggleConfig(config, params.activeSessionId)
    },
    stopCollaboration() {
      if (params.activeSessionId) api.cancelWaggle(params.activeSessionId)
      params.stopWaggleCollaboration()
    },
  }
}
