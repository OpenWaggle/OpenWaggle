import type { Message, MessageRole } from './agent'
import type { AgentAuthorizationMode } from './agent-authorization'
import type { RunMode } from './background-run'
import type { SessionBranchId, SessionId, SessionNodeId } from './brand'
import type { SessionEnvironmentMode } from './git'
import type { SupportedModelId } from './llm'
import type { DelegationState } from './session-collaboration'
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

export interface SessionLineageSummary {
  readonly role: 'queen' | 'worker' | 'independent'
  readonly parentSessionId?: SessionId
  readonly parentTitle?: string
  readonly hiveRootSessionId?: SessionId
  readonly directWorkerCount: number
  readonly activeDirectWorkerCount: number
  readonly agentDefinitionName?: string
  readonly delegationId?: string
  readonly delegationState?: DelegationState
}

export interface SessionDerivationSummary {
  readonly sourceSessionId: SessionId
  readonly sourceTitle?: string
  readonly sourceNodeId: SessionNodeId
  readonly position: 'before' | 'at'
}

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
  /** Resolves this session's working path, so per-session git state can be shown in lists. */
  readonly environmentMode?: SessionEnvironmentMode
  readonly worktreePath?: string | null
  readonly lineage?: SessionLineageSummary
  readonly derivation?: SessionDerivationSummary
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
  /** Session environment mode (ADR 0010); defaults to 'local'. */
  readonly environmentMode?: SessionEnvironmentMode
  /** Path of this session's Session worktree when in worktree mode. */
  readonly worktreePath?: string | null
  /** Chosen Worktree base ref for birth (ADR 0010); defaults to current branch. */
  readonly worktreeBaseRef?: string | null
  /** When true, the Session worktree is forked from origin/<baseRef>. */
  readonly worktreeStartFromOrigin?: boolean
  /** Authorization mode used by this session's runs. */
  readonly authorizationMode?: AgentAuthorizationMode
  /** Immutable model selected by this Session's persisted execution profile. */
  readonly executionModel?: SupportedModelId
}

/** Per-session worktree birth plan persisted by the composer strip (WS1b). */
export interface SessionWorktreePlan {
  readonly environmentMode: SessionEnvironmentMode
  readonly baseRef: string | null
  readonly startFromOrigin: boolean
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

/**
 * A Pinned session: one session the user marked for quick access.
 *
 * `sortKey` is a fractional index string carrying the user's Manual order, not a
 * position integer (ADR 0019), so moving one pin writes only that pin's row.
 */
export interface PinnedSession {
  readonly sessionId: SessionId
  readonly pinnedAt: number
  readonly sortKey: string
}

/**
 * A request to reposition one pin, expressed by the neighbours it should land between.
 *
 * Neighbours are session ids rather than sort keys so callers work from what they
 * rendered and never handle keys. `null` on either side means that end of the list.
 */
export interface PinnedSessionMove {
  readonly sessionId: SessionId
  readonly afterSessionId: SessionId | null
  readonly beforeSessionId: SessionId | null
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
