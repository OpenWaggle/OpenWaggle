import type { MessageRole } from '@shared/types/agent'
import type {
  ArchivedItemRef,
  ArchivedItemRefsPage,
  ArchivedItemsPage,
  ArchivedItemsQuery,
  ArchivedItemsRefsQuery,
} from '@shared/types/archived-items'
import type { RunMode } from '@shared/types/background-run'
import type { SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import type { HivePendingRequest } from '@shared/types/hive-next-actor'
import type { SupportedModelId } from '@shared/types/llm'
import type {
  SessionCatalogPage,
  SessionContentTree,
  SessionContentWorkspace,
  SessionNode,
  SessionNodeKind,
  SessionProjectPage,
  SessionSummary,
  SessionTreeUiStatePatch,
  SessionWorkspaceSelection,
} from '@shared/types/session'
import type {
  HiveSessionCatalogPage,
  HiveTreeSessionCatalogPage,
} from '@shared/types/session-hive-catalog'
import type { WaggleConfig } from '@shared/types/waggle'
import { Context, type Effect } from 'effect'
import type { SessionProjectionRepositoryError } from '../errors'

export interface ProjectedSessionNodeInput {
  readonly id: string
  readonly parentId: string | null
  readonly piEntryType: string
  readonly kind: SessionNodeKind
  readonly role: MessageRole | null
  readonly timestampMs: number
  readonly contentJson: string
  readonly metadataJson: string
  readonly pathDepth: number
  readonly createdOrder: number
}

export interface PersistSessionSnapshotInput {
  readonly sessionId: SessionId
  readonly nodes: readonly ProjectedSessionNodeInput[]
  readonly activeNodeId: string | null
  readonly piSessionId: string
  readonly piSessionFile?: string
  readonly waggleConfig?: WaggleConfig
}

export interface UpdateSessionRuntimeInput {
  readonly sessionId: SessionId
  readonly piSessionId?: string
  readonly piSessionFile?: string
}

export interface PersistSessionActiveRunInput {
  readonly runId: string
  readonly sessionId: SessionId
  readonly branchId: SessionBranchId
  readonly runMode: RunMode
  readonly model: SupportedModelId
}

export interface SessionActiveRunIdentity {
  readonly sessionId: SessionId
  readonly runId: string
}

export interface SessionInterruptedRunScope {
  readonly sessionId: SessionId
  readonly branchId: SessionBranchId
}

export interface RecoverableSessionActiveRun {
  readonly runId: string
  readonly sessionId: SessionId
  readonly branchId: SessionBranchId
  readonly runMode: RunMode
  readonly model: SupportedModelId
}

export interface SessionRepositoryShape {
  readonly list: (
    limit?: number,
  ) => Effect.Effect<readonly SessionSummary[], SessionProjectionRepositoryError>
  readonly listCatalogPage: (
    archived: boolean,
    limit: number,
    cursor?: string,
  ) => Effect.Effect<SessionCatalogPage, SessionProjectionRepositoryError>
  readonly listProjectPage: (
    limit: number,
    cursor?: string,
    search?: string,
    matchingDisplayNamePaths?: readonly string[],
  ) => Effect.Effect<SessionProjectPage, SessionProjectionRepositoryError>
  readonly hasActiveProjectPath: (
    paths: readonly string[],
  ) => Effect.Effect<boolean, SessionProjectionRepositoryError>
  readonly listByIds: (
    sessionIds: readonly SessionId[],
  ) => Effect.Effect<readonly SessionSummary[], SessionProjectionRepositoryError>
  readonly listHiveCatalogPage: (
    sessionId: SessionId,
    limit: number,
    cursor?: string,
  ) => Effect.Effect<HiveSessionCatalogPage, SessionProjectionRepositoryError>
  /** `pendingRequests` are the Host's parked requests, for the Hive's Needs you count (ADR 0059). */
  readonly listHiveTreeCatalogPage: (
    sessionId: SessionId,
    limit: number,
    cursor?: string,
    pendingRequests?: ReadonlyMap<string, HivePendingRequest>,
  ) => Effect.Effect<HiveTreeSessionCatalogPage, SessionProjectionRepositoryError>
  readonly listArchivedBranchCatalogPage: (
    limit: number,
    cursor?: string,
  ) => Effect.Effect<SessionCatalogPage, SessionProjectionRepositoryError>
  readonly listArchivedBranches: (
    limit?: number,
  ) => Effect.Effect<readonly SessionSummary[], SessionProjectionRepositoryError>
  /** One page of Settings > Archived items, with its Archive facet counts. */
  readonly queryArchivedItems: (
    query: ArchivedItemsQuery,
  ) => Effect.Effect<ArchivedItemsPage, SessionProjectionRepositoryError>
  /** The Archived items a filter matches, for Select all. */
  readonly listArchivedItemRefs: (
    query: ArchivedItemsRefsQuery,
  ) => Effect.Effect<ArchivedItemRefsPage, SessionProjectionRepositoryError>
  /**
   * Each item's Archive time keyed by `archivedItemKey`, or null when it is not archived; an item
   * that does not exist has no entry.
   */
  readonly readArchivedItemStates: (
    refs: readonly ArchivedItemRef[],
  ) => Effect.Effect<ReadonlyMap<string, number | null>, SessionProjectionRepositoryError>
  /** Puts back the Archive times an Undo carries, on items that are archived. */
  readonly setArchiveTimes: (
    entries: readonly { readonly ref: ArchivedItemRef; readonly archivedAt: number }[],
  ) => Effect.Effect<void, SessionProjectionRepositoryError>
  readonly getTree: (
    sessionId: SessionId,
  ) => Effect.Effect<SessionContentTree | null, SessionProjectionRepositoryError>
  /**
   * The Session's node mutation revision, which bumps whenever an existing node is updated or
   * deleted or one is inserted into history; null when the Session has no control state. Read it
   * before the nodes it labels, so content is never newer than the revision it is labelled with.
   */
  readonly getNodeMutationRevision: (
    sessionId: SessionId,
  ) => Effect.Effect<number | null, SessionProjectionRepositoryError>
  /** Tree node ids whose transcript search text contains `query`, case folded. */
  readonly searchTreeNodes: (
    sessionId: SessionId,
    query: string,
  ) => Effect.Effect<readonly SessionNodeId[], SessionProjectionRepositoryError>
  readonly listResourceProjectionPage: (
    sessionId: SessionId,
    afterCreatedOrder: number,
    limit: number,
  ) => Effect.Effect<
    {
      readonly nodes: readonly SessionNode[]
      readonly throughCreatedOrder: number | null
      readonly hasMore: boolean
    },
    SessionProjectionRepositoryError
  >
  readonly getResourceProjectionNodes: (
    sessionId: SessionId,
    nodeIds: readonly string[],
  ) => Effect.Effect<readonly SessionNode[], SessionProjectionRepositoryError>
  readonly getWorkspace: (
    sessionId: SessionId,
    selection?: SessionWorkspaceSelection,
  ) => Effect.Effect<SessionContentWorkspace | null, SessionProjectionRepositoryError>
  readonly persistSnapshot: (
    input: PersistSessionSnapshotInput,
  ) => Effect.Effect<void, SessionProjectionRepositoryError>
  readonly updateRuntime: (
    input: UpdateSessionRuntimeInput,
  ) => Effect.Effect<void, SessionProjectionRepositoryError>
  readonly renameBranch: (
    sessionId: SessionId,
    branchId: SessionBranchId,
    name: string,
  ) => Effect.Effect<void, SessionProjectionRepositoryError>
  readonly archiveBranch: (
    sessionId: SessionId,
    branchId: SessionBranchId,
  ) => Effect.Effect<void, SessionProjectionRepositoryError>
  readonly restoreBranch: (
    sessionId: SessionId,
    branchId: SessionBranchId,
  ) => Effect.Effect<void, SessionProjectionRepositoryError>
  readonly updateTreeUiState: (
    sessionId: SessionId,
    patch: SessionTreeUiStatePatch,
  ) => Effect.Effect<void, SessionProjectionRepositoryError>
  readonly recordActiveRun: (
    input: PersistSessionActiveRunInput,
  ) => Effect.Effect<void, SessionProjectionRepositoryError>
  readonly clearActiveRun: (
    input: SessionActiveRunIdentity,
  ) => Effect.Effect<void, SessionProjectionRepositoryError>
  readonly clearInterruptedRuns: (
    input: SessionInterruptedRunScope,
  ) => Effect.Effect<void, SessionProjectionRepositoryError>
  readonly listActiveRunsForRecovery: () => Effect.Effect<
    readonly RecoverableSessionActiveRun[],
    SessionProjectionRepositoryError
  >
  readonly markActiveRunInterrupted: (
    input: SessionActiveRunIdentity,
  ) => Effect.Effect<void, SessionProjectionRepositoryError>
}

export class SessionRepository extends Context.Tag('@openwaggle/SessionRepository')<
  SessionRepository,
  SessionRepositoryShape
>() {}
