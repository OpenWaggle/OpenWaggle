import type { SessionSummary } from '@shared/types/session'
import { buildSessionProvenance, describeSessionRow } from '../lib/session-provenance'
import { useSessionGitBranch, useSessionGitIndicator } from './useSessionGitIndicators'

/**
 * One hover description for a session row.
 *
 * Built from the same facts the row's icons carry, because the stretched click target makes a
 * title on any inner element unreachable: a pseudo-element is hit-tested as part of the element
 * that owns it, so pointer events anywhere in the row resolve to the title control. Screen readers
 * still read each icon's own aria-label; this is what restores the pointer route.
 */
export function useSessionRowDescription(input: {
  readonly session: SessionSummary
  readonly projectLabel: string
  readonly stateLabel: string | null
  readonly hasInterruptedRun: boolean
}): string | undefined {
  const gitBranch = useSessionGitBranch(input.session)
  const gitIndicator = useSessionGitIndicator(input.session)
  const indicators = buildSessionProvenance({
    session: input.session,
    gitBranch,
    terminalCount: 0,
  })

  return describeSessionRow({
    indicators,
    projectLabel: input.projectLabel,
    stateLabel: input.stateLabel,
    gitDivergence: gitIndicator.label === '' ? null : gitIndicator.description,
    hasInterruptedRun: input.hasInterruptedRun,
  })
}
