import { safeDecodeUnknown } from '@shared/schema'
import { jsonObjectSchema } from '@shared/schemas/validation'
import type {
  ChangeRequestMergeability,
  ChangeRequestReviewDecision,
  ChangeRequestState,
  VcsChangeRequestCheck,
} from '@shared/types/git'

export const MAX_CHANGE_REQUEST_ITEMS = 100
export const CHANGE_REQUEST_MERGE_METHODS = ['merge', 'squash', 'rebase'] as const

export function asObject(value: unknown) {
  const decoded = safeDecodeUnknown(jsonObjectSchema, value)
  return decoded.success ? decoded.data : null
}

export function asCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

export function asNumericCount(value: unknown): number | null {
  const number = typeof value === 'string' && /^\d+$/u.test(value.trim()) ? Number(value) : value
  return asCount(number)
}

export function boundedObjects(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_CHANGE_REQUEST_ITEMS).flatMap((entry) => {
    const object = asObject(entry)
    return object ? [object] : []
  })
}

export function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Why a change request cannot merge yet, or null when nothing blocks it. `noun` names the
 * provider's change request, and `rulesBlocked` reports any provider-specific blocking state
 * beyond a `blocked` mergeability.
 */
export function changeRequestMergeBlocker(input: {
  readonly noun: 'pull request' | 'merge request'
  readonly state: ChangeRequestState
  readonly headCommit: string | null
  readonly checks: readonly VcsChangeRequestCheck[]
  readonly reviewDecision: ChangeRequestReviewDecision
  readonly mergeability: ChangeRequestMergeability
  readonly rulesBlocked: boolean
}) {
  if (input.state === 'draft') return `Mark this ${input.noun} ready for review before merging.`
  if (input.state !== 'open') return `Only an open ${input.noun} can be merged.`
  if (!input.headCommit) return 'The head commit is unavailable. Refresh before merging.'
  if (input.mergeability === 'conflicting') return 'Resolve merge conflicts before merging.'
  if (input.mergeability === 'unknown') return 'Mergeability is still being calculated.'
  if (input.reviewDecision === 'changes-requested') {
    return 'Resolve requested review changes before merging.'
  }
  if (input.reviewDecision === 'review-required') return 'Required review approval is missing.'
  if (input.checks.some((check) => check.status === 'failed' || check.status === 'cancelled')) {
    return 'Fix failing checks before merging.'
  }
  if (input.checks.some((check) => check.status === 'pending')) {
    return 'Wait for all checks to finish before merging.'
  }
  if (input.mergeability === 'blocked' || input.rulesBlocked) {
    return 'Repository rules currently block this merge.'
  }
  return null
}
