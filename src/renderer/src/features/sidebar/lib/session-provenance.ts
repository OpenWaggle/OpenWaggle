import type { SessionSummary } from '@shared/types/session'

/**
 * What kind of session a row describes, as opposed to what the session needs from you.
 *
 * Provenance is a separate icon family from status, and the two never share a glyph. At the
 * 10px the second line renders at, a user reads silhouette rather than detail, so two
 * concepts drawn alike are the same concept. ADR 0020 records the vocabulary and why each
 * glyph was chosen over the conventional alternative.
 */
export type SessionProvenanceKind =
  | 'git-branch'
  | 'worktree'
  | 'cloned-from'
  | 'conversation-branches'
  | 'terminal'

export interface SessionProvenanceIndicator {
  readonly kind: SessionProvenanceKind
  /** Rendered beside the glyph when a count is the actionable part. Never a name. */
  readonly count?: number
  /** Tooltip and accessible name. Carries the value the glyph itself cannot show. */
  readonly description: string
}

export interface SessionProvenanceInput {
  readonly session: SessionSummary
  readonly gitBranch: string | null
  /**
   * Terminals alive for this session.
   *
   * TODO(#97-followup): terminals are keyed by project path, not by session. `terminal:create`
   * takes a `projectPath` and returns a `terminalId`, and nothing records which session
   * opened it, so a per-session count cannot be derived today. Callers pass 0 until a
   * terminal carries its owning session id. The render path below is complete, so the glyph
   * appears the moment a real count exists.
   */
  readonly terminalCount: number
}

/** Non-archived conversation branches, which is what a count on a row means. */
function visibleBranchCount(session: SessionSummary) {
  const branches = session.branches ?? []
  return branches.filter((branch) => branch.archived !== true).length
}

function clonedFromSessionDescription(session: SessionSummary) {
  if (!session.derivation) return null
  return session.derivation.sourceTitle ?? String(session.derivation.sourceSessionId)
}

/**
 * Build the provenance indicators for one session row, in render order.
 *
 * Order is fixed rather than data-dependent so a row's second line does not reshuffle as
 * state arrives: branch, worktree, origin, conversation branches, terminals.
 */
export function buildSessionProvenance(
  input: SessionProvenanceInput,
): readonly SessionProvenanceIndicator[] {
  const indicators: SessionProvenanceIndicator[] = []
  const { session, gitBranch, terminalCount } = input

  // Guarded on content, not just on null: an empty name produced an icon announced as
  // "On branch " with nothing after it.
  const branchName = gitBranch?.trim() ?? ''
  if (branchName !== '') {
    indicators.push({ kind: 'git-branch', description: `On branch ${branchName}` })
  }

  if (session.environmentMode === 'worktree') {
    indicators.push({ kind: 'worktree', description: 'Runs in its own worktree' })
  }

  const clonedFrom = clonedFromSessionDescription(session)
  if (clonedFrom !== null) {
    indicators.push({ kind: 'cloned-from', description: `Cloned from ${clonedFrom}` })
  }

  const branchCount = visibleBranchCount(session)
  if (branchCount > 1) {
    indicators.push({
      kind: 'conversation-branches',
      count: branchCount,
      description: `${String(branchCount)} conversation branches`,
    })
  }

  if (terminalCount > 0) {
    const plural = terminalCount === 1 ? 'process' : 'processes'
    indicators.push({
      kind: 'terminal',
      description: `${String(terminalCount)} terminal ${plural} running`,
    })
  }

  return indicators
}

/**
 * One hover description for a whole row.
 *
 * The row's click target is stretched over the row with a pseudo-element, and a pseudo-element is
 * hit-tested as part of the element that owns it. Pointer events anywhere in the row therefore
 * target the title control, so a title on an inner span is unreachable. Composing the same
 * descriptions onto the row itself keeps them readable, since the lookup walks ancestors.
 */
export function describeSessionRow(input: {
  readonly indicators: readonly SessionProvenanceIndicator[]
  readonly projectLabel: string
  readonly stateLabel: string | null
  readonly gitDivergence: string | null
  readonly hasInterruptedRun: boolean
}): string | undefined {
  const parts = [
    input.projectLabel,
    input.stateLabel,
    ...input.indicators.map((indicator) => indicator.description),
    input.gitDivergence,
    input.hasInterruptedRun ? 'A run was interrupted in this session' : null,
  ].filter((part): part is string => typeof part === 'string' && part.length > 0)

  return parts.length === 0 ? undefined : parts.join(' \u00b7 ')
}
