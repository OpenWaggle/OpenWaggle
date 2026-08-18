import type { AgentSendPayload, PreparedAttachment } from './agent'
import type { OAuthAccountInfo, OAuthProvider } from './auth'
import type { ActiveRunInfo, BackgroundRunSnapshot } from './background-run'
import type { RepositoryPath, SessionId, WagglePresetId, WorkingPath } from './brand'
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
  GitBranchListResult,
  GitBranchMutationResult,
  GitCommitPayload,
  GitCommitResult,
  GitDiffResult,
  GitRunStackedActionOptions,
  GitRunStackedActionResult,
  GitStatusSummary,
  GitWorkingTreeMutationResult,
  GitWorktreeCreatePayload,
  GitWorktreeListResult,
  GitWorktreeMutationResult,
  GitWorktreeRemovePayload,
  LocalVcsStatusResult,
  RemoteVcsStatusResult,
  SessionWorktreeCheck,
} from './git'
import type { SupportedModelId } from './llm'
import type { AgentPhaseState } from './phase'
import type {
  AgentsInstructionStatus,
  AgentsResolutionResult,
  SkillCatalogResult,
} from './standards'
import type { TurnCheckpointSummary, TurnDiff } from './turn-diff'
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
    args: [workingPath: WorkingPath]
    return: GitStatusSummary
  }
  'git:commit': {
    args: [workingPath: WorkingPath, payload: GitCommitPayload]
    return: GitCommitResult
  }
  'git:diff': {
    args: [workingPath: WorkingPath]
    return: GitDiffResult
  }
  'git:branch-diff': {
    args: [workingPath: WorkingPath, baseRef: string]
    return: GitDiffResult
  }
  'git:working-tree:stage-all': {
    args: [workingPath: WorkingPath]
    return: GitWorkingTreeMutationResult
  }
  'git:working-tree:revert-all': {
    args: [workingPath: WorkingPath]
    return: GitWorkingTreeMutationResult
  }
  'git:branches:list': {
    args: [repositoryPath: RepositoryPath]
    return: GitBranchListResult
  }
  'git:branches:checkout': {
    args: [workingPath: WorkingPath, payload: GitBranchCheckoutPayload]
    return: GitBranchMutationResult
  }
  'git:branches:create': {
    args: [workingPath: WorkingPath, payload: GitBranchCreatePayload]
    return: GitBranchMutationResult
  }
  'git:worktrees:list': {
    args: [repositoryPath: RepositoryPath]
    return: GitWorktreeListResult
  }
  'git:worktrees:create': {
    args: [repositoryPath: RepositoryPath, payload: GitWorktreeCreatePayload]
    return: GitWorktreeMutationResult
  }
  'git:worktrees:remove': {
    args: [repositoryPath: RepositoryPath, payload: GitWorktreeRemovePayload]
    return: GitWorktreeMutationResult
  }
  'git:worktrees:check': {
    args: [worktreePath: string | null]
    return: SessionWorktreeCheck
  }
  'git:vcs-status:local': {
    args: [workingPath: WorkingPath]
    return: LocalVcsStatusResult
  }
  'git:vcs-status:remote': {
    args: [workingPath: WorkingPath]
    return: RemoteVcsStatusResult
  }
  'git:stacked-action:run': {
    args: [workingPath: WorkingPath, options: GitRunStackedActionOptions]
    return: GitRunStackedActionResult
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
  'sessions:turn-checkpoints:list': {
    args: [id: SessionId]
    return: TurnCheckpointSummary[]
  }
  'sessions:turn-diff:get': {
    args: [id: SessionId, turnId: string]
    return: TurnDiff | null
  }
}
