import type { RunId, SessionId } from '@shared/types/brand'

export interface SpawnAdmissionInput {
  readonly parentSessionId: SessionId
  readonly expectedParentRunId: RunId
  readonly parentRun:
    | { readonly state: 'idle' }
    | { readonly state: 'active' | 'starting' | 'stopping'; readonly runId: RunId }
  readonly parentRunningChildren: number
  readonly parentConcurrencyLimit: number
  /** Active Runs of agents' work across the Host; the person's Runs in their own roots use none. */
  readonly hostActiveRuns: number
  /** The Host's ceiling on active Worker Runs (`sessionHostRunCeiling`). */
  readonly hostRunCeiling: number
}

export type SpawnAdmissionResult =
  | {
      readonly accepted: true
      readonly parentRemainingSlots: number
      readonly hostRemainingSlots: number
    }
  | {
      readonly accepted: false
      readonly code:
        | 'parent_run_not_active'
        | 'parent_run_changed'
        | 'parent_capacity_reached'
        | 'host_capacity_reached'
      readonly retryable: boolean
      readonly parentConcurrencyLimit: number
      readonly parentRunningChildren: number
      readonly hostRunCeiling: number
      readonly hostActiveRuns: number
    }

export function decideSpawnAdmission(input: SpawnAdmissionInput) {
  const rejected = (
    code: Extract<SpawnAdmissionResult, { readonly accepted: false }>['code'],
    retryable: boolean,
  ) => ({
    accepted: false as const,
    code,
    retryable,
    parentConcurrencyLimit: input.parentConcurrencyLimit,
    parentRunningChildren: input.parentRunningChildren,
    hostRunCeiling: input.hostRunCeiling,
    hostActiveRuns: input.hostActiveRuns,
  })

  if (input.parentRun.state !== 'active') {
    if (input.parentRun.state !== 'idle' && input.parentRun.runId !== input.expectedParentRunId) {
      return rejected('parent_run_changed', false) satisfies SpawnAdmissionResult
    }
    return rejected('parent_run_not_active', true) satisfies SpawnAdmissionResult
  }
  if (input.parentRun.runId !== input.expectedParentRunId) {
    return rejected('parent_run_changed', false) satisfies SpawnAdmissionResult
  }
  if (input.parentRunningChildren >= input.parentConcurrencyLimit) {
    return rejected('parent_capacity_reached', true) satisfies SpawnAdmissionResult
  }
  if (input.hostActiveRuns >= input.hostRunCeiling) {
    return rejected('host_capacity_reached', true) satisfies SpawnAdmissionResult
  }
  return {
    accepted: true,
    parentRemainingSlots: input.parentConcurrencyLimit - input.parentRunningChildren - 1,
    hostRemainingSlots: input.hostRunCeiling - input.hostActiveRuns - 1,
  } satisfies SpawnAdmissionResult
}
