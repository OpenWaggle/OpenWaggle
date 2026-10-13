import type { SessionSummary } from './session'

/*
 * Hive catalog pages, read by the Session Hub's Hive row and the Hive panel (ADR 0051).
 */

/** A focused Session, its parent, and one keyset page of its direct Workers. */
export interface HiveSessionCatalogPage {
  readonly context: readonly SessionSummary[]
  readonly workers: readonly SessionSummary[]
  readonly nextCursor?: string
}

/** A Hive's Queen and one keyset page of its members at any depth (ADR 0051). */
export interface HiveTreeSessionCatalogPage {
  readonly root: SessionSummary | null
  readonly members: readonly SessionSummary[]
  /**
   * Live members, across every page, whose Delegation needs the user (`needs_attention` or
   * `revision_requested`), so the rail dot is right however far the panel has paged. A parked
   * request does not change the Delegation state, so it is not counted here; the Queen's
   * sidebar line also reads row states and does report it (`workerAttentionByQueen`).
   */
  readonly attentionCount: number
  readonly nextCursor?: string
}
