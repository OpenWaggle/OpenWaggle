import { matchBy } from '@diegogbrisa/ts-match'
import { normalizeSessionReportReference } from '@shared/session-report-reference'
import type { SessionId } from '@shared/types/brand'

export type ReportTargetSelector =
  | { readonly type: 'upstream' }
  | { readonly type: 'queen' }
  | { readonly type: 'session'; readonly sessionId: SessionId }
  | { readonly type: 'sessions'; readonly sessionIds: readonly SessionId[] }
  | { readonly type: 'worker-reference'; readonly reference: string }

export interface ReportSourceLineage {
  readonly sessionId: SessionId
  readonly parentSessionId: SessionId | null
  readonly queenSessionId: SessionId | null
}

export interface AuthorizedReportCandidate {
  readonly sessionId: SessionId
  readonly referenceNames: readonly string[]
}

export interface ResolveReportTargetsInput {
  readonly selector: ReportTargetSelector
  readonly source: ReportSourceLineage
  readonly authorizedCandidates: readonly AuthorizedReportCandidate[]
}

export type ReportTargetResolution =
  | { readonly resolved: true; readonly targetSessionIds: readonly SessionId[] }
  | {
      readonly resolved: false
      readonly code:
        | 'lineage_target_missing'
        | 'target_is_source'
        | 'target_not_authorized'
        | 'target_not_found'
        | 'target_ambiguous'
        | 'targets_empty'
      readonly candidates?: readonly SessionId[]
    }

function resolvedTarget(sourceSessionId: SessionId, targetSessionId: SessionId | null) {
  if (targetSessionId === null) {
    const resolution: ReportTargetResolution = { resolved: false, code: 'lineage_target_missing' }
    return resolution
  }
  if (targetSessionId === sourceSessionId) {
    const resolution: ReportTargetResolution = { resolved: false, code: 'target_is_source' }
    return resolution
  }
  const resolution: ReportTargetResolution = { resolved: true, targetSessionIds: [targetSessionId] }
  return resolution
}

function resolveExplicitTargets(
  sourceSessionId: SessionId,
  requestedSessionIds: readonly SessionId[],
  candidates: readonly AuthorizedReportCandidate[],
) {
  const uniqueSessionIds = [...new Set(requestedSessionIds)]
  if (uniqueSessionIds.length === 0) {
    const resolution: ReportTargetResolution = { resolved: false, code: 'targets_empty' }
    return resolution
  }
  if (uniqueSessionIds.includes(sourceSessionId)) {
    const resolution: ReportTargetResolution = { resolved: false, code: 'target_is_source' }
    return resolution
  }
  const authorizedSessionIds = new Set(candidates.map((candidate) => candidate.sessionId))
  if (uniqueSessionIds.some((sessionId) => !authorizedSessionIds.has(sessionId))) {
    const resolution: ReportTargetResolution = { resolved: false, code: 'target_not_authorized' }
    return resolution
  }
  const resolution: ReportTargetResolution = { resolved: true, targetSessionIds: uniqueSessionIds }
  return resolution
}

function resolveWorkerReference(
  sourceSessionId: SessionId,
  reference: string,
  candidates: readonly AuthorizedReportCandidate[],
) {
  const normalized = normalizeSessionReportReference(reference)
  const matches = candidates.filter((candidate) =>
    candidate.referenceNames.some((name) => normalizeSessionReportReference(name) === normalized),
  )
  if (matches.length === 0) {
    const resolution: ReportTargetResolution = { resolved: false, code: 'target_not_found' }
    return resolution
  }
  if (matches.length > 1) {
    const resolution: ReportTargetResolution = {
      resolved: false,
      code: 'target_ambiguous',
      candidates: matches.map((candidate) => candidate.sessionId),
    }
    return resolution
  }
  const targetSessionId = matches[0]?.sessionId ?? null
  const resolution: ReportTargetResolution = resolvedTarget(sourceSessionId, targetSessionId)
  return resolution
}

export function resolveReportTargets(input: ResolveReportTargetsInput) {
  return matchBy(input.selector, 'type')
    .with('upstream', () => resolvedTarget(input.source.sessionId, input.source.parentSessionId))
    .with('queen', () => resolvedTarget(input.source.sessionId, input.source.queenSessionId))
    .with('session', (selector) =>
      resolveExplicitTargets(
        input.source.sessionId,
        [selector.sessionId],
        input.authorizedCandidates,
      ),
    )
    .with('sessions', (selector) =>
      resolveExplicitTargets(
        input.source.sessionId,
        selector.sessionIds,
        input.authorizedCandidates,
      ),
    )
    .with('worker-reference', (selector) =>
      resolveWorkerReference(
        input.source.sessionId,
        selector.reference,
        input.authorizedCandidates,
      ),
    )
    .exhaustive()
}
