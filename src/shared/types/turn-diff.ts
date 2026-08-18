/**
 * Turn diff types (WS7, ADR 0011): per-turn worktree checkpoints and the diffs
 * computed from them. Kept separate from Pi session (conversation) snapshots.
 */

export interface TurnDiffFileSummary {
  readonly path: string
  readonly additions: number
  readonly deletions: number
}

export interface TurnDiff {
  readonly turnId: string
  readonly diff: string
  readonly files: readonly TurnDiffFileSummary[]
  readonly insertions: number
  readonly deletions: number
}

export interface TurnCheckpointSummary {
  readonly turnId: string
  readonly turnIndex: number
  readonly createdAt: number
  readonly insertions: number
  readonly deletions: number
  /** Persisted assistant node id this turn's diff is anchored to (transcript reveal). */
  readonly anchorNodeId?: string | null
}
