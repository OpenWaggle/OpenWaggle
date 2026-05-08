import type { Message, MessageRole } from './agent'
import type { RunMode } from './background-run'
import type { SessionBranchId, SessionId, SessionNodeId } from './brand'
import type { SupportedModelId } from './llm'
import type { WaggleConfig } from './waggle'

export type SessionNodeKind =
  | 'user_message'
  | 'assistant_message'
  | 'system_message'
  | 'tool_result'
  | 'custom'
  | 'session_info'
  | 'label'
  | 'model_change'
  | 'thinking_level_change'
  | 'branch_summary'
  | 'compaction_summary'

export type SessionFutureMode = 'standard' | 'waggle'
export type SessionTreeFilterMode = 'default' | 'no-tools' | 'user-only' | 'labeled-only' | 'all'

export interface SessionSummary {
  readonly id: SessionId
  readonly title: string
  readonly projectPath: string | null
  readonly messageCount?: number
  readonly archived?: boolean
  readonly createdAt: number
  readonly updatedAt: number
  readonly lastActiveNodeId?: SessionNodeId | null
  readonly lastActiveBranchId?: SessionBranchId | null
  readonly branches?: readonly SessionBranch[]
  readonly treeUiState?: SessionTreeUiState | null
}

export interface SessionInterruptedRun {
  readonly runId: string
  readonly sessionId: SessionId
  readonly branchId: SessionBranchId
  readonly runMode: RunMode
  readonly model: SupportedModelId
  readonly interruptedAt: number
}

export interface SessionDetail {
  readonly id: SessionId
  readonly title: string
  readonly projectPath: string | null
  readonly piSessionId?: string
  readonly piSessionFile?: string
  readonly messages: Message[]
  readonly waggleConfig?: WaggleConfig
  readonly archived?: boolean
  readonly createdAt: number
  readonly updatedAt: number
}

export interface SessionNode {
  readonly id: SessionNodeId
  readonly sessionId: SessionId
  readonly parentId: SessionNodeId | null
  readonly piEntryType: string
  readonly kind: SessionNodeKind
  readonly role?: MessageRole
  readonly timestampMs: number
  readonly createdOrder: number
  readonly pathDepth: number
  readonly branchId?: SessionBranchId | null
  readonly message?: Message
  readonly contentJson: string
  readonly metadataJson: string
}

export interface SessionBranch {
  readonly id: SessionBranchId
  readonly sessionId: SessionId
  readonly sourceNodeId: SessionNodeId | null
  readonly headNodeId: SessionNodeId | null
  readonly name: string
  readonly isMain: boolean
  readonly archived?: boolean
  readonly archivedAt?: number | null
  readonly interruptedRun?: SessionInterruptedRun
  readonly createdAt: number
  readonly updatedAt: number
}

export interface SessionBranchState {
  readonly branchId: SessionBranchId
  readonly futureMode: SessionFutureMode
  readonly waggleConfig?: WaggleConfig
  readonly lastActiveAt: number
  readonly uiStateJson: string
}

export interface SessionTreeUiState {
  readonly sessionId: SessionId
  readonly expandedNodeIds: readonly SessionNodeId[]
  readonly expandedNodeIdsTouched: boolean
  readonly branchesSidebarCollapsed: boolean
  readonly updatedAt: number
}

export interface SessionTreeUiStatePatch {
  readonly expandedNodeIds?: readonly SessionNodeId[]
  readonly branchesSidebarCollapsed?: boolean
}

export interface SessionTree {
  readonly session: SessionSummary
  readonly nodes: readonly SessionNode[]
  readonly branches: readonly SessionBranch[]
  readonly branchStates: readonly SessionBranchState[]
  readonly uiState: SessionTreeUiState | null
}

export interface SessionWorkspaceSelection {
  readonly branchId?: SessionBranchId | null
  readonly nodeId?: SessionNodeId | null
}

export interface SessionNavigateTreeOptions {
  readonly summarize?: boolean
  readonly customInstructions?: string
}

export interface SessionCopyToNewResult {
  readonly session?: SessionDetail
  readonly editorText?: string
  readonly cancelled: boolean
}

export interface SessionTranscriptEntry {
  readonly node: SessionNode
  readonly branchId?: SessionBranchId | null
  readonly isActive: boolean
}

export interface SessionWorkspace {
  readonly tree: SessionTree
  readonly activeBranchId: SessionBranchId | null
  readonly activeNodeId: SessionNodeId | null
  readonly activeBranchState?: SessionBranchState
  readonly transcriptPath: readonly SessionTranscriptEntry[]
}
