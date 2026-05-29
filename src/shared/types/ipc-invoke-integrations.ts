import type { AgentSendPayload, PreparedAttachment } from './agent'
import type { OAuthAccountInfo, OAuthProvider } from './auth'
import type { ActiveRunInfo, BackgroundRunSnapshot } from './background-run'
import type { SessionId, WagglePresetId } from './brand'
import type { FileSuggestion } from './composer'
import type {
  DiagnosticsInfo,
  FeedbackPayload,
  FeedbackSubmitResult,
  GhCliStatus,
} from './feedback'
import type {
  GitBranchCheckoutPayload,
  GitBranchCreatePayload,
  GitBranchDeletePayload,
  GitBranchListResult,
  GitBranchMutationResult,
  GitBranchRenamePayload,
  GitBranchSetUpstreamPayload,
  GitCommitPayload,
  GitCommitResult,
  GitFileDiff,
  GitStatusSummary,
} from './git'
import type { SupportedModelId } from './llm'
import type { AgentPhaseState } from './phase'
import type {
  AgentsInstructionStatus,
  AgentsResolutionResult,
  SkillCatalogResult,
} from './standards'
import type { UpdateStatus } from './updater'
import type { VoiceTranscriptionRequest, VoiceTranscriptionResult } from './voice'
import type { WaggleConfig, WagglePreset } from './waggle'

// ─── IPC Channel Map ─────────────────────────────────────────
// Single source of truth for every IPC channel.
// Each entry defines: [channel name, args tuple, return type]

export interface IpcIntegrationInvokeChannelMap {
  'terminal:create': {
    args: [projectPath: string]
    return: string
  }
  'terminal:close': {
    args: [terminalId: string]
    return: undefined
  }
  'terminal:resize': {
    args: [terminalId: string, cols: number, rows: number]
    return: undefined
  }
  'git:status': {
    args: [projectPath: string]
    return: GitStatusSummary
  }
  'git:commit': {
    args: [projectPath: string, payload: GitCommitPayload]
    return: GitCommitResult
  }
  'git:diff': {
    args: [projectPath: string]
    return: GitFileDiff[]
  }
  'git:branches:list': {
    args: [projectPath: string]
    return: GitBranchListResult
  }
  'git:branches:checkout': {
    args: [projectPath: string, payload: GitBranchCheckoutPayload]
    return: GitBranchMutationResult
  }
  'git:branches:create': {
    args: [projectPath: string, payload: GitBranchCreatePayload]
    return: GitBranchMutationResult
  }
  'git:branches:rename': {
    args: [projectPath: string, payload: GitBranchRenamePayload]
    return: GitBranchMutationResult
  }
  'git:branches:delete': {
    args: [projectPath: string, payload: GitBranchDeletePayload]
    return: GitBranchMutationResult
  }
  'git:branches:set-upstream': {
    args: [projectPath: string, payload: GitBranchSetUpstreamPayload]
    return: GitBranchMutationResult
  }
  'attachments:prepare': {
    args: [projectPath: string, paths: string[]]
    return: PreparedAttachment[]
  }
  'attachments:prepare-from-text': {
    args: [text: string, operationId: string]
    return: PreparedAttachment
  }
  'agent:get-phase': {
    args: [sessionId: SessionId]
    return: AgentPhaseState | null
  }
  'agent:get-background-run': {
    args: [sessionId: SessionId]
    return: BackgroundRunSnapshot | null
  }
  'agent:list-active-runs': {
    args: []
    return: ActiveRunInfo[]
  }
  'voice:transcribe-local': {
    args: [payload: VoiceTranscriptionRequest]
    return: VoiceTranscriptionResult
  }
  'standards:get-status': {
    args: [projectPath: string]
    return: { agents: AgentsInstructionStatus; agentsPath: string; error?: string }
  }
  'standards:get-effective-agents': {
    args: [projectPath: string, targetPath?: string]
    return: AgentsResolutionResult
  }
  'skills:list': {
    args: [projectPath: string]
    return: SkillCatalogResult
  }
  'skills:set-enabled': {
    args: [projectPath: string, skillId: string, enabled: boolean]
    return: undefined
  }
  'skills:get-preview': {
    args: [projectPath: string, skillId: string]
    return: { markdown: string }
  }
  'dialog:confirm': {
    args: [message: string, detail?: string]
    return: boolean
  }
  'app:open-logs-dir': {
    args: []
    return: undefined
  }
  'app:get-logs-path': {
    args: []
    return: string
  }
  // Waggle mode
  'agent:send-waggle-message': {
    args: [
      sessionId: SessionId,
      payload: AgentSendPayload,
      model: SupportedModelId,
      config: WaggleConfig,
    ]
    return: undefined
  }
  // Auth
  'auth:start-oauth': {
    args: [provider: OAuthProvider]
    return: undefined
  }
  'auth:disconnect': {
    args: [provider: OAuthProvider]
    return: undefined
  }
  'auth:get-account-info': {
    args: [provider: OAuthProvider]
    return: OAuthAccountInfo
  }
  'auth:submit-code': {
    args: [provider: OAuthProvider, code: string]
    return: undefined
  }
  'auth:cancel-oauth': {
    args: [provider: OAuthProvider]
    return: undefined
  }
  'auth:set-api-key': {
    args: [provider: string, apiKey: string]
    return: undefined
  }
  // Waggle presets
  'waggle-presets:list': {
    args: [projectPath?: string | null]
    return: WagglePreset[]
  }
  'waggle-presets:save': {
    args: [preset: WagglePreset, projectPath?: string | null]
    return: WagglePreset
  }
  'waggle-presets:delete': {
    args: [id: WagglePresetId, projectPath?: string | null]
    return: undefined
  }
  // Feedback
  'feedback:check-gh': {
    args: []
    return: GhCliStatus
  }
  'feedback:collect-diagnostics': {
    args: []
    return: DiagnosticsInfo
  }
  'feedback:get-recent-logs': {
    args: [lineCount: number]
    return: string
  }
  'feedback:submit': {
    args: [payload: FeedbackPayload]
    return: FeedbackSubmitResult
  }
  'feedback:generate-markdown': {
    args: [payload: FeedbackPayload]
    return: string
  }
  'shell:open-external': {
    args: [url: string]
    return: undefined
  }
  'shell:open-path': {
    args: [path: string]
    return: undefined
  }
  // Composer
  'composer:file-suggest': {
    args: [projectPath: string, query: string]
    return: FileSuggestion[]
  }
  // Auto-updater
  'updater:check': {
    args: []
    return: undefined
  }
  'updater:install': {
    args: []
    return: undefined
  }
  'updater:get-status': {
    args: []
    return: UpdateStatus
  }
  'app:get-version': {
    args: []
    return: string
  }
}
