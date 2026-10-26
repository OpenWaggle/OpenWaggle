import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/lib/ipc', () => ({ api: {} }))

import { withStuckCandidateWorkers } from '../useSessionHostRefresh'

function worker(id: string, parent: string, state: 'needs_attention' | 'working'): SessionSummary {
  return {
    id: SessionId(id),
    title: id,
    projectPath: '/project',
    createdAt: 1,
    updatedAt: 1,
    lineage: {
      role: 'worker',
      parentSessionId: SessionId(parent),
      directWorkerCount: 0,
      activeDirectWorkerCount: 0,
      delegationState: state,
    },
  }
}

describe('withStuckCandidateWorkers', () => {
  it('reads a parent’s needs_attention Workers again when the parent changes (issue 380)', () => {
    const sessions = [
      worker('failed', 'queen', 'needs_attention'),
      worker('busy', 'queen', 'working'),
      worker('elsewhere', 'other', 'needs_attention'),
    ]
    expect(withStuckCandidateWorkers(new Set(['queen']), sessions)).toEqual(['queen', 'failed'])
    expect(withStuckCandidateWorkers(new Set(['busy']), sessions)).toEqual(['busy'])
  })
})
