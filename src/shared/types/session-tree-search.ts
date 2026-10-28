import type { SessionNodeId } from './brand'

/**
 * Where a Session tree search stopped: the last node it read, at the Session's node mutation
 * revision. While the revision holds, no node it read has changed, so the next search for the same
 * query reads only the nodes appended after it (review V2 P3-1).
 */
export interface SessionTreeSearchCursor {
  readonly throughCreatedOrder: number
  readonly nodeMutationRevision: number
}

/** One tree search's matches (`sessions:search-tree`). */
export interface SessionTreeSearchPage {
  readonly nodeIds: readonly SessionNodeId[]
  /** The matches are among the nodes after the given cursor only: add them to its result. */
  readonly incremental: boolean
  /** Null when the Session has no control state: the next search reads every node again. */
  readonly cursor: SessionTreeSearchCursor | null
}
