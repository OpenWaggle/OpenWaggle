import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId, SupportedModelId } from '@shared/types/brand'
import type { ExtensionInvokeScope } from '@shared/types/extension-broker'
import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import type { WaggleCollaborationStatus, WaggleConfig } from '@shared/types/waggle'
import { useBranchSummaryStore } from '@/features/chat/state/branch-summary-store'
import {
  type ExtensionSlashCommand,
  extensionSlashCommandPayload,
  parseCompactCommand,
  parseExtensionSlashCommand,
  parseSessionCopyCommand,
} from '@/features/composer/commands'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import type { useBranchSummaryWorkflow } from './useBranchSummaryWorkflow'
import type { useSessionCopyWorkflow } from './useSessionCopyWorkflow'

const logger = createRendererLogger('chat-send-workflow')

interface ChatSendWorkflowParams {
  readonly activeSessionId: SessionId | null
  readonly branchSummary: ReturnType<typeof useBranchSummaryWorkflow>
  readonly clearDraftBranchForSession: (sessionId: SessionId) => void
  readonly draftBranch: Parameters<
    ReturnType<typeof useBranchSummaryWorkflow>['materializeDraftBranchForSend']
  >[0]
  readonly extensionContributions: ExtensionContributionRegistryView | null
  readonly handleSend: (payload: AgentSendPayload) => Promise<void>
  readonly handleSendWaggle: (payload: AgentSendPayload, config: WaggleConfig) => Promise<void>
  readonly model: SupportedModelId
  readonly phase: { readonly reset: () => void }
  readonly projectPath: string | null
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

function extensionSlashCommandScope(params: ChatSendWorkflowParams): ExtensionInvokeScope | null {
  if (!params.projectPath) {
    return null
  }

  if (!params.activeSessionId) {
    return { kind: 'project', projectPath: params.projectPath }
  }

  return {
    kind: 'session',
    projectPath: params.projectPath,
    sessionId: params.activeSessionId,
  }
}

async function invokeExtensionSlashCommand(
  params: ChatSendWorkflowParams,
  command: ExtensionSlashCommand,
) {
  const { entry } = command
  if (!entry.capability || !entry.method) {
    return
  }

  const scope = extensionSlashCommandScope(params)
  if (!scope) {
    params.showToast('Select a project before running extension slash commands.')
    return
  }

  try {
    const result = await api.invokeExtension({
      extensionId: entry.extensionId,
      contributionId: entry.contributionId,
      capability: entry.capability,
      method: entry.method,
      scope,
      payload: extensionSlashCommandPayload(command),
    })

    if (!result.ok) {
      logger.warn('Extension slash command rejected', {
        extensionId: entry.extensionId,
        contributionId: entry.contributionId,
        code: result.error.code,
      })
      params.showToast(result.error.message)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('Extension slash command failed', {
      extensionId: entry.extensionId,
      contributionId: entry.contributionId,
      error: message,
    })
    params.showToast(message)
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

  const extensionSlashCommand = parseExtensionSlashCommand(text, params.extensionContributions)
  if (extensionSlashCommand) {
    await invokeExtensionSlashCommand(params, extensionSlashCommand)
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
