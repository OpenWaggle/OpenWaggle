import { matchBy } from '@diegogbrisa/ts-match'
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

function resolvedTarget(
  sourceSessionId: SessionId,
  targetSessionId: SessionId | null,
): ReportTargetResolution {
  if (targetSessionId === null) return { resolved: false, code: 'lineage_target_missing' }
  if (targetSessionId === sourceSessionId) return { resolved: false, code: 'target_is_source' }
  return { resolved: true, targetSessionIds: [targetSessionId] }
}

function resolveExplicitTargets(
  sourceSessionId: SessionId,
  requestedSessionIds: readonly SessionId[],
  candidates: readonly AuthorizedReportCandidate[],
): ReportTargetResolution {
  const uniqueSessionIds = [...new Set(requestedSessionIds)]
  if (uniqueSessionIds.length === 0) return { resolved: false, code: 'targets_empty' }
  if (uniqueSessionIds.includes(sourceSessionId)) {
    return { resolved: false, code: 'target_is_source' }
  }
  const authorizedSessionIds = new Set(candidates.map((candidate) => candidate.sessionId))
  if (uniqueSessionIds.some((sessionId) => !authorizedSessionIds.has(sessionId))) {
    return { resolved: false, code: 'target_not_authorized' }
  }
  return { resolved: true, targetSessionIds: uniqueSessionIds }
}

function normalizedReference(value: string) {
  return value.trim().toLocaleLowerCase()
}

function resolveWorkerReference(
  sourceSessionId: SessionId,
  reference: string,
  candidates: readonly AuthorizedReportCandidate[],
): ReportTargetResolution {
  const normalized = normalizedReference(reference)
  const matches = candidates.filter((candidate) =>
    candidate.referenceNames.some((name) => normalizedReference(name) === normalized),
  )
  if (matches.length === 0) return { resolved: false, code: 'target_not_found' }
  if (matches.length > 1) {
    return {
      resolved: false,
      code: 'target_ambiguous',
      candidates: matches.map((candidate) => candidate.sessionId),
    }
  }
  const targetSessionId = matches[0]?.sessionId ?? null
  return resolvedTarget(sourceSessionId, targetSessionId)
}

export function resolveReportTargets(input: ResolveReportTargetsInput): ReportTargetResolution {
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
