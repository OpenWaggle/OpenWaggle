import { SupportedModelId } from '@shared/types/brand'
import type { WaggleAgentSlot } from '@shared/types/waggle'
import { fromAny } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it } from 'vitest'
import { FileConflictTracker } from '../file-conflict-tracker'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeAgents(labelA = 'Architect', labelB = 'Reviewer') {
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
  })

  // ── Same agent modifies same file again ──────────────────────────────────

  describe('same agent modifying the same file again', () => {
    it('returns null on second modification by the same agent', () => {
      tracker.recordModification('src/index.ts', 0, agents, 1)
      const warning = tracker.recordModification('src/index.ts', 0, agents, 2)
      expect(warning).toBeNull()
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
  })

  // ── Multiple files tracked independently ─────────────────────────────────

  describe('tracking multiple files independently', () => {
    it('does not emit a warning when different agents each own a distinct file', () => {
      const warningA = tracker.recordModification('src/a.ts', 0, agents, 1)
      const warningB = tracker.recordModification('src/b.ts', 1, agents, 1)

      expect(warningA).toBeNull()
      expect(warningB).toBeNull()
    })

    it('conflict on file A does not affect file B state', () => {
      tracker.recordModification('src/a.ts', 0, agents, 1)
      tracker.recordModification('src/b.ts', 1, agents, 1)
      tracker.recordModification('src/a.ts', 1, agents, 2)

      expect(tracker.recordModification('src/b.ts', 1, agents, 3)).toBeNull()
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
  })

  // ── Agent label fallback ──────────────────────────────────────────────────

  describe('agent label fallback', () => {
    it('falls back to "Agent 0" when agents tuple does not cover index 0', () => {
      const sparseAgents = fromAny<readonly [WaggleAgentSlot, WaggleAgentSlot], unknown>([
        undefined,
        {
          label: 'Reviewer',
          model: SupportedModelId('claude-sonnet-4-5'),
          roleDescription: '',
          color: 'amber',
        },
      ])

      tracker.recordModification('src/index.ts', 0, sparseAgents, 1)
      const warning = tracker.recordModification('src/index.ts', 1, sparseAgents, 2)

      expect(warning?.previousAgent).toBe('Agent 0')
      expect(warning?.currentAgent).toBe('Reviewer')
    })

    it('falls back to "Agent 1" when agents tuple does not cover index 1', () => {
      const sparseAgents = fromAny<readonly [WaggleAgentSlot, WaggleAgentSlot], unknown>([
        {
          label: 'Architect',
          model: SupportedModelId('claude-sonnet-4-5'),
          roleDescription: '',
          color: 'blue',
        },
        undefined,
      ])

      tracker.recordModification('src/index.ts', 0, sparseAgents, 1)
      const warning = tracker.recordModification('src/index.ts', 1, sparseAgents, 2)

      expect(warning?.previousAgent).toBe('Architect')
      expect(warning?.currentAgent).toBe('Agent 1')
    })
  })
})
