import type { WaggleTeamPreset } from '@shared/types/waggle'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted in-memory state shared between the mock and the test body.
// vi.hoisted ensures the value is available before vi.mock factories run.
// ---------------------------------------------------------------------------

const mockStoreData = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
}))

// ---------------------------------------------------------------------------
// Mock electron-store
// The module under test calls `new Store({ name: 'teams', defaults: { presets: [] } })`
// at the top level, so the mock must be in place before the first import.
// ---------------------------------------------------------------------------

vi.mock('electron-store', () => {
  class MockStore<T extends object> {
    constructor(options: { defaults?: Partial<T> }) {
      // Seed defaults only if the key is absent from the shared state object.
      if (options.defaults) {
        for (const [key, value] of Object.entries(options.defaults)) {
          if (!(key in mockStoreData.data)) {
            mockStoreData.data[key] = value
          }
        }
      }
    }

    get<K extends keyof T>(key: K, defaultValue?: T[K]): T[K] {
      const k = key as string
      if (k in mockStoreData.data) {
        return mockStoreData.data[k] as T[K]
      }
      return defaultValue as T[K]
    }

    set<K extends keyof T>(key: K, value: T[K]): void {
      mockStoreData.data[key as string] = value
    }
  }

  return { default: MockStore }
})

// ---------------------------------------------------------------------------
// Mock the logger — avoids fs writes and console noise during the test run.
// ---------------------------------------------------------------------------

vi.mock('../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid WaggleTeamPreset fixture for user-created presets. */
function makeUserPreset(overrides: Partial<WaggleTeamPreset> = {}): WaggleTeamPreset {
  return {
    id: 'user-preset-1' as WaggleTeamPreset['id'],
    name: 'My Custom Team',
    description: 'A custom team preset',
    config: {
      mode: 'sequential',
      agents: [
        {
          label: 'Planner',
          model: 'claude-sonnet-4-5',
          roleDescription: 'Plans the work.',
          color: 'blue',
        },
        {
          label: 'Executor',
          model: 'claude-sonnet-4-5',
          roleDescription: 'Executes the plan.',
          color: 'amber',
        },
      ],
      stop: { primary: 'consensus', maxTurnsSafety: 6 },
    },
    isBuiltIn: false,
    createdAt: 1_000_000,
    updatedAt: 1_000_000,
    ...overrides,
  } as WaggleTeamPreset
}

/** Lazily import the module under test AFTER mocks are set up. */
async function loadTeamsModule() {
  vi.resetModules()
  return import('../teams')
}

// ---------------------------------------------------------------------------
// Built-in preset ids (must match what teams.ts defines)
// ---------------------------------------------------------------------------

const BUILT_IN_IDS = ['builtin-code-review', 'builtin-debate', 'builtin-red-team']

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('teams store', () => {
  beforeEach(() => {
    // Reset the shared in-memory store before every test.
    mockStoreData.data = {}
  })

  // ── listTeamPresets ────────────────────────────────────────────────────────

  describe('listTeamPresets', () => {
    it('returns exactly the three built-in presets when the user store is empty', async () => {
      const { listTeamPresets } = await loadTeamsModule()
      const presets = listTeamPresets()

      const ids = presets.map((p) => p.id)
      for (const builtInId of BUILT_IN_IDS) {
        expect(ids).toContain(builtInId)
      }
      expect(presets).toHaveLength(3)
    })

    it('includes the correct preset names for the built-in presets', async () => {
      const { listTeamPresets } = await loadTeamsModule()
      const presets = listTeamPresets()

      const names = presets.map((p) => p.name)
      expect(names).toContain('Code Review')
      expect(names).toContain('Debate')
      expect(names).toContain('Red Team')
    })

    it('returns built-in presets first, followed by user presets', async () => {
      mockStoreData.data.presets = [makeUserPreset()]

      const { listTeamPresets } = await loadTeamsModule()
      const presets = listTeamPresets()

      expect(presets.length).toBe(4)
      expect(BUILT_IN_IDS).toContain(presets[0].id)
      expect(presets[3].id).toBe('user-preset-1')
    })

    it('returns an empty user section when store contains invalid JSON (Zod parse fails)', async () => {
      // Zod will reject this because required fields are missing.
      mockStoreData.data.presets = [{ id: 'bad', notAPreset: true }]

      const { listTeamPresets } = await loadTeamsModule()
      const presets = listTeamPresets()

      // Only built-ins should be returned
      expect(presets).toHaveLength(3)
    })
  })

  // ── saveTeamPreset ─────────────────────────────────────────────────────────

  describe('saveTeamPreset', () => {
    it('adds a new preset that can be retrieved via listTeamPresets', async () => {
      const { saveTeamPreset, listTeamPresets } = await loadTeamsModule()
      const newPreset = makeUserPreset()

      saveTeamPreset(newPreset)

      const all = listTeamPresets()
      const found = all.find((p) => p.id === newPreset.id)
      expect(found).toBeDefined()
      expect(found?.name).toBe('My Custom Team')
    })

    it('forces isBuiltIn to false regardless of what is passed in', async () => {
      const { saveTeamPreset } = await loadTeamsModule()
      const preset = makeUserPreset({ isBuiltIn: true as unknown as false })

      const saved = saveTeamPreset(preset)

      expect(saved.isBuiltIn).toBe(false)
    })

    it('updates updatedAt to a recent timestamp', async () => {
      const before = Date.now()
      const { saveTeamPreset } = await loadTeamsModule()
      const saved = saveTeamPreset(makeUserPreset())

      expect(saved.updatedAt).toBeGreaterThanOrEqual(before)
    })

    it('preserves the original createdAt when it is already set', async () => {
      const { saveTeamPreset } = await loadTeamsModule()
      const preset = makeUserPreset({ createdAt: 42 })

      const saved = saveTeamPreset(preset)

      expect(saved.createdAt).toBe(42)
    })

    it('sets createdAt from Date.now() when it is 0 (falsy)', async () => {
      const before = Date.now()
      const { saveTeamPreset } = await loadTeamsModule()
      const preset = makeUserPreset({ createdAt: 0 })

      const saved = saveTeamPreset(preset)

      expect(saved.createdAt).toBeGreaterThanOrEqual(before)
    })

    it('updates an existing preset (upsert) rather than duplicating it', async () => {
      const { saveTeamPreset, listTeamPresets } = await loadTeamsModule()
      const original = makeUserPreset({ name: 'Original Name' })

      saveTeamPreset(original)
      saveTeamPreset({ ...original, name: 'Updated Name' })

      const all = listTeamPresets()
      const userPresets = all.filter((p) => !p.isBuiltIn)
      expect(userPresets).toHaveLength(1)
      expect(userPresets[0].name).toBe('Updated Name')
    })

    it('can save multiple distinct user presets', async () => {
      const { saveTeamPreset, listTeamPresets } = await loadTeamsModule()

      saveTeamPreset(makeUserPreset({ id: 'user-1' as WaggleTeamPreset['id'], name: 'Team Alpha' }))
      saveTeamPreset(makeUserPreset({ id: 'user-2' as WaggleTeamPreset['id'], name: 'Team Beta' }))

      const all = listTeamPresets()
      const userPresets = all.filter((p) => !p.isBuiltIn)
      expect(userPresets).toHaveLength(2)
    })

    it('returns the saved preset', async () => {
      const { saveTeamPreset } = await loadTeamsModule()
      const preset = makeUserPreset()

      const result = saveTeamPreset(preset)

      expect(result.id).toBe(preset.id)
      expect(result.name).toBe(preset.name)
    })
  })

  // ── deleteTeamPreset ───────────────────────────────────────────────────────

  describe('deleteTeamPreset', () => {
    it('removes a previously saved user preset', async () => {
      const { saveTeamPreset, deleteTeamPreset, listTeamPresets } = await loadTeamsModule()
      saveTeamPreset(makeUserPreset({ id: 'to-delete' as WaggleTeamPreset['id'] }))

      deleteTeamPreset('to-delete')

      const all = listTeamPresets()
      expect(all.find((p) => p.id === 'to-delete')).toBeUndefined()
    })

    it('does not affect other user presets when one is deleted', async () => {
      const { saveTeamPreset, deleteTeamPreset, listTeamPresets } = await loadTeamsModule()
      saveTeamPreset(makeUserPreset({ id: 'keep-me' as WaggleTeamPreset['id'], name: 'Keep' }))
      saveTeamPreset(makeUserPreset({ id: 'remove-me' as WaggleTeamPreset['id'], name: 'Remove' }))

      deleteTeamPreset('remove-me')

      const all = listTeamPresets()
      expect(all.find((p) => p.id === 'keep-me')).toBeDefined()
      expect(all.find((p) => p.id === 'remove-me')).toBeUndefined()
    })

    it('leaves built-in presets intact after deleting a user preset', async () => {
      const { saveTeamPreset, deleteTeamPreset, listTeamPresets } = await loadTeamsModule()
      saveTeamPreset(makeUserPreset())

      deleteTeamPreset('user-preset-1')

      const all = listTeamPresets()
      const ids = all.map((p) => p.id)
      for (const builtInId of BUILT_IN_IDS) {
        expect(ids).toContain(builtInId)
      }
    })

    it('does nothing when deleting a built-in preset id (not present in user store)', async () => {
      // Built-ins are never written to the user store, so the filter is a no-op.
      const { deleteTeamPreset, listTeamPresets } = await loadTeamsModule()

      expect(() => deleteTeamPreset('builtin-code-review')).not.toThrow()

      const all = listTeamPresets()
      expect(all.find((p) => p.id === 'builtin-code-review')).toBeDefined()
    })

    it('does nothing when given an id that does not exist in the store', async () => {
      const { deleteTeamPreset, listTeamPresets } = await loadTeamsModule()

      expect(() => deleteTeamPreset('nonexistent-id')).not.toThrow()

      const all = listTeamPresets()
      expect(all).toHaveLength(3) // only built-ins
    })

    it('is idempotent — deleting the same preset twice does not throw', async () => {
      const { saveTeamPreset, deleteTeamPreset } = await loadTeamsModule()
      saveTeamPreset(makeUserPreset())

      deleteTeamPreset('user-preset-1')

      expect(() => deleteTeamPreset('user-preset-1')).not.toThrow()
    })
  })
})
