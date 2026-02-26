import { SupportedModelId } from '@shared/types/brand'
import type { AgentSlot } from '@shared/types/multi-agent'
import { beforeEach, describe, expect, it } from 'vitest'
import { FileConflictTracker } from '../file-conflict-tracker'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeAgents(labelA = 'Architect', labelB = 'Reviewer'): readonly [AgentSlot, AgentSlot] {
  return [
    {
      label: labelA,
      model: SupportedModelId('claude-sonnet-4-5'),
      roleDescription: 'Role A',
      color: 'blue',
    },
    {
      label: labelB,
      model: SupportedModelId('claude-sonnet-4-5'),
      roleDescription: 'Role B',
      color: 'amber',
    },
  ] as const
}

// ---------------------------------------------------------------------------
// FileConflictTracker
// ---------------------------------------------------------------------------

describe('FileConflictTracker', () => {
  let tracker: FileConflictTracker
  const agents = makeAgents()

  beforeEach(() => {
    tracker = new FileConflictTracker()
  })

  // ── First modification ────────────────────────────────────────────────────

  describe('first modification of a file', () => {
    it('returns null when agent 0 first touches a file', () => {
      const warning = tracker.recordModification('src/index.ts', 0, agents, 1)
      expect(warning).toBeNull()
    })

    it('returns null when agent 1 first touches a different file', () => {
      const warning = tracker.recordModification('src/utils.ts', 1, agents, 1)
      expect(warning).toBeNull()
    })

    it('records the modification so the map is no longer empty', () => {
      tracker.recordModification('src/index.ts', 0, agents, 1)
      expect(tracker.getModifications().size).toBe(1)
    })
  })

  // ── Same agent modifies same file again ──────────────────────────────────

  describe('same agent modifying the same file again', () => {
    it('returns null on second modification by the same agent', () => {
      tracker.recordModification('src/index.ts', 0, agents, 1)
      const warning = tracker.recordModification('src/index.ts', 0, agents, 2)
      expect(warning).toBeNull()
    })

    it('increments the modification count without raising a conflict', () => {
      tracker.recordModification('src/index.ts', 0, agents, 1)
      tracker.recordModification('src/index.ts', 0, agents, 2)
      const record = tracker.getModifications().get('src/index.ts')
      expect(record?.modificationCount).toBe(2)
    })

    it('keeps the correct agent index in the record', () => {
      tracker.recordModification('src/index.ts', 1, agents, 1)
      tracker.recordModification('src/index.ts', 1, agents, 2)
      const record = tracker.getModifications().get('src/index.ts')
      expect(record?.lastModifiedBy).toBe(1)
    })
  })

  // ── Different agent modifies same file ───────────────────────────────────

  describe('different agent modifying the same file', () => {
    it('returns a non-null warning', () => {
      tracker.recordModification('src/index.ts', 0, agents, 1)
      const warning = tracker.recordModification('src/index.ts', 1, agents, 2)
      expect(warning).not.toBeNull()
    })

    it('warning contains the correct file path', () => {
      tracker.recordModification('src/index.ts', 0, agents, 1)
      const warning = tracker.recordModification('src/index.ts', 1, agents, 2)
      expect(warning?.path).toBe('src/index.ts')
    })

    it('warning contains the correct previousAgent label', () => {
      tracker.recordModification('src/index.ts', 0, agents, 1)
      const warning = tracker.recordModification('src/index.ts', 1, agents, 2)
      expect(warning?.previousAgent).toBe('Architect')
    })

    it('warning contains the correct currentAgent label', () => {
      tracker.recordModification('src/index.ts', 0, agents, 1)
      const warning = tracker.recordModification('src/index.ts', 1, agents, 2)
      expect(warning?.currentAgent).toBe('Reviewer')
    })

    it('warning contains the correct turnNumber', () => {
      tracker.recordModification('src/index.ts', 0, agents, 1)
      const warning = tracker.recordModification('src/index.ts', 1, agents, 2)
      expect(warning?.turnNumber).toBe(2)
    })

    it('updates the last-modified agent after a conflict', () => {
      tracker.recordModification('src/index.ts', 0, agents, 1)
      tracker.recordModification('src/index.ts', 1, agents, 2)
      const record = tracker.getModifications().get('src/index.ts')
      expect(record?.lastModifiedBy).toBe(1)
    })

    it('increments modification count after a conflict', () => {
      tracker.recordModification('src/index.ts', 0, agents, 1)
      tracker.recordModification('src/index.ts', 1, agents, 2)
      const record = tracker.getModifications().get('src/index.ts')
      expect(record?.modificationCount).toBe(2)
    })
  })

  // ── Multiple files tracked independently ─────────────────────────────────

  describe('tracking multiple files independently', () => {
    it('does not emit a warning when different agents each own a distinct file', () => {
      const warningA = tracker.recordModification('src/a.ts', 0, agents, 1)
      const warningB = tracker.recordModification('src/b.ts', 1, agents, 1)

      expect(warningA).toBeNull()
      expect(warningB).toBeNull()
    })

    it('tracks modification counts separately per file', () => {
      tracker.recordModification('src/a.ts', 0, agents, 1)
      tracker.recordModification('src/b.ts', 1, agents, 1)
      tracker.recordModification('src/a.ts', 0, agents, 2)

      expect(tracker.getModifications().get('src/a.ts')?.modificationCount).toBe(2)
      expect(tracker.getModifications().get('src/b.ts')?.modificationCount).toBe(1)
    })

    it('conflict on file A does not affect file B state', () => {
      tracker.recordModification('src/a.ts', 0, agents, 1)
      tracker.recordModification('src/b.ts', 1, agents, 1)

      // Cause a conflict on file A
      tracker.recordModification('src/a.ts', 1, agents, 2)

      // File B should still be owned by agent 1 with count 1
      const recordB = tracker.getModifications().get('src/b.ts')
      expect(recordB?.lastModifiedBy).toBe(1)
      expect(recordB?.modificationCount).toBe(1)
    })

    it('reports the correct total number of tracked files', () => {
      tracker.recordModification('src/a.ts', 0, agents, 1)
      tracker.recordModification('src/b.ts', 0, agents, 1)
      tracker.recordModification('src/c.ts', 1, agents, 1)

      expect(tracker.getModifications().size).toBe(3)
    })
  })

  // ── Multiple conflicts on the same file ──────────────────────────────────

  describe('multiple conflicts on the same file', () => {
    it('emits a warning on each alternating modification', () => {
      tracker.recordModification('src/index.ts', 0, agents, 1)

      const first = tracker.recordModification('src/index.ts', 1, agents, 2)
      expect(first).not.toBeNull()

      const second = tracker.recordModification('src/index.ts', 0, agents, 3)
      expect(second).not.toBeNull()
    })

    it('second conflict swaps previousAgent and currentAgent correctly', () => {
      tracker.recordModification('src/index.ts', 0, agents, 1)
      tracker.recordModification('src/index.ts', 1, agents, 2)

      const warning = tracker.recordModification('src/index.ts', 0, agents, 3)
      // After first conflict, agent 1 owns the file.
      // Agent 0 is now the intruder — previousAgent should be agent 1.
      expect(warning?.previousAgent).toBe('Reviewer')
      expect(warning?.currentAgent).toBe('Architect')
    })

    it('modification count grows monotonically across conflicts', () => {
      tracker.recordModification('src/index.ts', 0, agents, 1) // count = 1
      tracker.recordModification('src/index.ts', 1, agents, 2) // count = 2 (conflict)
      tracker.recordModification('src/index.ts', 0, agents, 3) // count = 3 (conflict)

      const record = tracker.getModifications().get('src/index.ts')
      expect(record?.modificationCount).toBe(3)
    })
  })

  // ── Agent label fallback ──────────────────────────────────────────────────

  describe('agent label fallback', () => {
    it('falls back to "Agent 0" when agents tuple does not cover index 0', () => {
      // Cast to satisfy the readonly tuple type while simulating a missing entry
      const sparseAgents = [
        undefined,
        {
          label: 'Reviewer',
          model: SupportedModelId('claude-sonnet-4-5'),
          roleDescription: '',
          color: 'amber',
        },
      ] as unknown as readonly [AgentSlot, AgentSlot]

      tracker.recordModification('src/index.ts', 0, sparseAgents, 1)
      const warning = tracker.recordModification('src/index.ts', 1, sparseAgents, 2)

      expect(warning?.previousAgent).toBe('Agent 0')
      expect(warning?.currentAgent).toBe('Reviewer')
    })

    it('falls back to "Agent 1" when agents tuple does not cover index 1', () => {
      const sparseAgents = [
        {
          label: 'Architect',
          model: SupportedModelId('claude-sonnet-4-5'),
          roleDescription: '',
          color: 'blue',
        },
        undefined,
      ] as unknown as readonly [AgentSlot, AgentSlot]

      tracker.recordModification('src/index.ts', 0, sparseAgents, 1)
      const warning = tracker.recordModification('src/index.ts', 1, sparseAgents, 2)

      expect(warning?.previousAgent).toBe('Architect')
      expect(warning?.currentAgent).toBe('Agent 1')
    })
  })

  // ── reset() ───────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('clears all tracked modifications', () => {
      tracker.recordModification('src/a.ts', 0, agents, 1)
      tracker.recordModification('src/b.ts', 1, agents, 1)

      tracker.reset()

      expect(tracker.getModifications().size).toBe(0)
    })

    it('allows fresh tracking after reset with no prior-conflict leakage', () => {
      tracker.recordModification('src/index.ts', 0, agents, 1)
      tracker.recordModification('src/index.ts', 1, agents, 2) // conflict

      tracker.reset()

      // After reset, first touch by agent 0 should not produce a warning
      const warning = tracker.recordModification('src/index.ts', 0, agents, 1)
      expect(warning).toBeNull()
    })
  })

  // ── getModifications() ────────────────────────────────────────────────────

  describe('getModifications', () => {
    it('returns a ReadonlyMap', () => {
      const map = tracker.getModifications()
      // ReadonlyMap does not expose set/delete on the type level; verify it is map-like
      expect(typeof map.get).toBe('function')
      expect(typeof map.has).toBe('function')
      expect(typeof map.size).toBe('number')
    })

    it('reflects changes after a sequence of modifications', () => {
      tracker.recordModification('src/index.ts', 0, agents, 1)
      tracker.recordModification('src/utils.ts', 1, agents, 2)

      const map = tracker.getModifications()
      expect(map.has('src/index.ts')).toBe(true)
      expect(map.has('src/utils.ts')).toBe(true)
      expect(map.has('src/other.ts')).toBe(false)
    })
  })
})
