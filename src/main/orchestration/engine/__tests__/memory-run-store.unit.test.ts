import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryRunStore } from '../memory-run-store'
import type { OrchestrationRunRecord } from '../types'

function makeRun(overrides: Partial<OrchestrationRunRecord> = {}): OrchestrationRunRecord {
  return {
    runId: 'run-1',
    status: 'completed',
    startedAt: '2025-01-01T00:00:00Z',
    tasks: {},
    taskOrder: [],
    outputs: {},
    summary: {
      total: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      queued: 0,
      running: 0,
      retrying: 0,
    },
    ...overrides,
  }
}

describe('MemoryRunStore', () => {
  let store: MemoryRunStore

  beforeEach(() => {
    store = new MemoryRunStore()
  })

  // ── saveRun / getRun ──

  describe('saveRun and getRun', () => {
    it('stores and retrieves a run by ID', async () => {
      const run = makeRun({ runId: 'run-abc' })

      await store.saveRun(run)

      const retrieved = await store.getRun('run-abc')
      expect(retrieved).toEqual(run)
    })

    it('returns null for a non-existent run ID', async () => {
      const result = await store.getRun('does-not-exist')

      expect(result).toBeNull()
    })

    it('overwrites an existing run with the same ID', async () => {
      const v1 = makeRun({ runId: 'run-1', status: 'running' })
      const v2 = makeRun({ runId: 'run-1', status: 'completed' })

      await store.saveRun(v1)
      await store.saveRun(v2)

      const retrieved = await store.getRun('run-1')
      expect(retrieved?.status).toBe('completed')
    })

    it('stores multiple runs independently', async () => {
      const run1 = makeRun({ runId: 'run-1' })
      const run2 = makeRun({ runId: 'run-2' })

      await store.saveRun(run1)
      await store.saveRun(run2)

      expect(await store.getRun('run-1')).toEqual(run1)
      expect(await store.getRun('run-2')).toEqual(run2)
    })
  })

  // ── listRuns ──

  describe('listRuns', () => {
    it('returns an empty array when no runs exist', async () => {
      const runs = await store.listRuns()

      expect(runs).toEqual([])
    })

    it('returns all stored runs', async () => {
      await store.saveRun(makeRun({ runId: 'a', startedAt: '2025-01-01T00:00:00Z' }))
      await store.saveRun(makeRun({ runId: 'b', startedAt: '2025-01-02T00:00:00Z' }))

      const runs = await store.listRuns()

      expect(runs).toHaveLength(2)
    })

    it('sorts runs in descending order by startedAt (newest first)', async () => {
      await store.saveRun(makeRun({ runId: 'oldest', startedAt: '2025-01-01T00:00:00Z' }))
      await store.saveRun(makeRun({ runId: 'newest', startedAt: '2025-01-03T00:00:00Z' }))
      await store.saveRun(makeRun({ runId: 'middle', startedAt: '2025-01-02T00:00:00Z' }))

      const runs = await store.listRuns()

      expect(runs[0].runId).toBe('newest')
      expect(runs[1].runId).toBe('middle')
      expect(runs[2].runId).toBe('oldest')
    })

    it('returns a new array (not the internal reference)', async () => {
      await store.saveRun(makeRun({ runId: 'run-1' }))

      const first = await store.listRuns()
      const second = await store.listRuns()

      expect(first).not.toBe(second)
      expect(first).toEqual(second)
    })
  })
})
