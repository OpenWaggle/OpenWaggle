import type { Message, MessageRole } from './agent'
import type { AgentAuthorizationMode } from './agent-authorization'
import type { RunMode } from './background-run'
import type { SessionBranchId, SessionId, SessionNodeId } from './brand'
import type { SessionEnvironmentMode } from './git'
import type { SupportedModelId } from './llm'
import type { DelegationState } from './session-collaboration'
import type { ThinkingLevel } from './settings'
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
  /** Navigation-only ancestry from the retired MCP task runner, never Host authority. */
  readonly historical?: boolean
}

export interface SessionDerivationSummary {
  readonly sourceSessionId: SessionId
  readonly sourceTitle?: string
  readonly sourceNodeId: SessionNodeId
  readonly position: 'before' | 'at'
}

/** Durable state of the most recently updated Run for a Session. */
export interface SessionLatestRunSummary {
  readonly status:
    | 'starting'
    | 'active'
    | 'stopping'
    | 'completed'
    | 'failed'
    | 'interrupted'
    | 'interrupted-by-host-loss'
    | 'interrupted-by-interaction-timeout'
  readonly updatedAt: number
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
  /** Persisted Run settlement used to rebuild renderer status after reconnect. */
  readonly latestRun?: SessionLatestRunSummary
  /** Creation time of the oldest outstanding non-notify agent interaction. */
  readonly pendingInteractionAt?: number
  /** Host time when the pending-interaction set was sampled, including when it was empty. */
  readonly pendingInteractionSnapshotAt?: number
  /**
   * Acquisition time of the earliest live Follow-up edit hold: the queue is waiting on the user's
   * edit (sidebar: "Waiting on your edit"). Sampled with the pending-interaction set.
   */
  readonly followUpEditHeldAt?: number
}

/** Opaque keyset page used by the GUI Session catalog. */
export interface SessionCatalogPage {
  readonly sessions: readonly SessionSummary[]
  readonly nextCursor?: string
}

/** Distinct Session project paths, ordered by path for bounded Settings discovery. */
export interface SessionProjectPage {
  readonly paths: readonly string[]
  readonly nextCursor?: string
}

/** A focused Session, its parent, and one keyset page of its direct Workers. */
export interface HiveSessionCatalogPage {
  readonly context: readonly SessionSummary[]
  readonly workers: readonly SessionSummary[]
  readonly nextCursor?: string
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
  /**
   * The Session thinking level its next Run uses (clamped to the model when the Run starts). It
   * changes only while no Run is active, and never changes another Session.
   */
  readonly executionThinkingLevel?: ThinkingLevel
  /** Conversation position the Session resumes from; see {@link SessionResumePosition}. */
  readonly resumePosition?: SessionResumePosition
}

/**
 * The outcome of setting a Session's thinking level. It changes only while the Session has no
 * starting, active, or stopping Run; `session_run_active` refuses it otherwise.
 */
export type SessionThinkingLevelChange =
  | { readonly changed: true }
  | { readonly changed: false; readonly code: 'session_run_active' | 'session_profile_not_found' }

/**
 * The conversation position selected in the projection (the active branch head, or the node a
 * branch switch or retry navigated to), with the number of Pi entries the projection had seen.
 *
 * Pi keeps its tree position in memory and reopens a session file at its last entry, so a
 * selection made by one Pi operation is lost by the next. Pi operations restore this position
 * instead, but only while the Pi file still holds exactly `piEntryCount` entries: a file with
 * entries the projection has not seen is newer than the selection and keeps its own position.
 */
export interface SessionResumePosition {
  readonly nodeId: SessionNodeId
  readonly piEntryCount: number
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
  /** Durable read receipt for terminal Run state. */
  readonly lastVisitedAt?: number
  readonly updatedAt: number
}

export interface SessionTreeUiStatePatch {
  readonly expandedNodeIds?: readonly SessionNodeId[]
  readonly branchesSidebarCollapsed?: boolean
  readonly lastVisitedAt?: number
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
