import { RunId, SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { decideSpawnAdmission } from '../spawn-admission'
import { classifyRootHiveRole, planChildLineage } from '../spawn-lineage'

const base = {
  parentSessionId: SessionId('session-parent'),
  expectedParentRunId: RunId('run-parent'),
  parentRun: { state: 'active' as const, runId: RunId('run-parent') },
  parentRunningChildren: 1,
  parentConcurrencyLimit: 4,
  hostActiveRuns: 3,
  hostRunCeiling: 16,
}

describe('Session spawn admission', () => {
  it('admits against parent and Host capacity without a Workspace or depth cap', () => {
    expect(decideSpawnAdmission(base)).toEqual({
      accepted: true,
      parentRemainingSlots: 2,
      hostRemainingSlots: 12,
    })
  })

  it('rejects an exhausted user-configured parent limit without silently queueing', () => {
    expect(
      decideSpawnAdmission({ ...base, parentRunningChildren: 8, parentConcurrencyLimit: 8 }),
    ).toMatchObject({
      accepted: false,
      code: 'parent_capacity_reached',
      retryable: true,
      parentConcurrencyLimit: 8,
      parentRunningChildren: 8,
    })
  })

  it('rejects a stale parent Run before capacity admission', () => {
    expect(
      decideSpawnAdmission({
        ...base,
        parentRun: { state: 'active', runId: RunId('run-newer') },
        hostActiveRuns: 16,
      }),
    ).toMatchObject({ accepted: false, code: 'parent_run_changed', retryable: false })
  })
})

describe('Hive lineage', () => {
  it('keeps every descendant a Worker while preserving one Queen root', () => {
    expect(
      planChildLineage({
        parentSessionId: SessionId('session-worker'),
        hiveRootSessionId: SessionId('session-queen'),
        depth: 2,
      }),
    ).toEqual({
      hiveRootSessionId: SessionId('session-queen'),
      depth: 3,
      hiveRole: 'worker',
    })
    expect(classifyRootHiveRole(false)).toBe('independent-root')
    expect(classifyRootHiveRole(true)).toBe('queen')
  })
})
