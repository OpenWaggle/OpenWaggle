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
   * Live members and the Queen, across every page, whose next actor is the user (ADR 0059): a
   * parked approval or question, or a stuck Worker no agent will pick up. The rail dot reads it,
   * so it is right however far the panel has paged.
   */
  readonly needsYouCount: number
  readonly nextCursor?: string
}
