import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SupportedModelId, TeamConfigId } from '@shared/types/brand'
import type { WaggleTeamPreset } from '@shared/types/waggle'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  userDataDir: '',
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => state.userDataDir,
  },
}))

vi.mock('../../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

function makeUserPreset(overrides: Partial<WaggleTeamPreset> = {}): WaggleTeamPreset {
  return {
    id: TeamConfigId('user-preset-1'),
    name: 'My Custom Team',
    description: 'A custom team preset',
    config: {
      mode: 'sequential',
      agents: [
        {
          label: 'Planner',
          model: SupportedModelId('claude-sonnet-4-5'),
          roleDescription: 'Plans the work.',
          color: 'blue',
        },
        {
          label: 'Executor',
          model: SupportedModelId('claude-sonnet-4-5'),
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
  }
}

async function disposeRuntime(): Promise<void> {
  const { disposeAppRuntime } = await import('../../runtime')
  await disposeAppRuntime()
}

async function loadTeamsModule() {
  const module = await import('../teams')
  await module.initializeTeamStore()
  return module
}

const BUILT_IN_IDS = ['builtin-code-review', 'builtin-debate', 'builtin-red-team']

describe('teams store', () => {
  beforeEach(async () => {
    await disposeRuntime()
    vi.resetModules()
    state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-teams-test-'))
  })

  afterEach(async () => {
    await disposeRuntime()
    if (state.userDataDir) {
      await fs.rm(state.userDataDir, { recursive: true, force: true })
    }
  })

  describe('listTeamPresets', () => {
    it('returns exactly the three built-in presets when the user store is empty', async () => {
      const { listTeamPresets } = await loadTeamsModule()
      const presets = listTeamPresets()

      const ids = presets.map((preset) => preset.id)
      for (const builtInId of BUILT_IN_IDS) {
        expect(ids).toContain(builtInId)
      }
      expect(presets).toHaveLength(3)
    })

    it('includes the correct preset names for the built-in presets', async () => {
      const { listTeamPresets } = await loadTeamsModule()
      const presets = listTeamPresets()

      const names = presets.map((preset) => preset.name)
      expect(names).toContain('Code Review')
      expect(names).toContain('Debate')
      expect(names).toContain('Red Team')
    })

    it('returns built-in presets first, followed by user presets', async () => {
      const { listTeamPresets, saveTeamPreset } = await loadTeamsModule()
      saveTeamPreset(makeUserPreset())

      const presets = listTeamPresets()

      expect(presets.length).toBe(4)
      expect(BUILT_IN_IDS).toContain(presets[0].id)
      expect(presets[3]?.id).toBe('user-preset-1')
    })
  })

  describe('saveTeamPreset', () => {
    it('adds a new preset that can be retrieved via listTeamPresets', async () => {
      const { listTeamPresets, saveTeamPreset } = await loadTeamsModule()
      const newPreset = makeUserPreset()

      saveTeamPreset(newPreset)

      const all = listTeamPresets()
      const found = all.find((preset) => preset.id === newPreset.id)
      expect(found).toBeDefined()
      expect(found?.name).toBe('My Custom Team')
    })

    it('forces isBuiltIn to false regardless of what is passed in', async () => {
      const { saveTeamPreset } = await loadTeamsModule()
      const preset = makeUserPreset({ isBuiltIn: true })

      expect(saveTeamPreset(preset).isBuiltIn).toBe(false)
    })

    it('updates an existing preset (upsert) rather than duplicating it', async () => {
      const { listTeamPresets, saveTeamPreset } = await loadTeamsModule()
      const original = makeUserPreset({ name: 'Original Name' })

      saveTeamPreset(original)
      saveTeamPreset({ ...original, name: 'Updated Name' })

      const userPresets = listTeamPresets().filter((preset) => !preset.isBuiltIn)
      expect(userPresets).toHaveLength(1)
      expect(userPresets[0]?.name).toBe('Updated Name')
    })

    it('can save multiple distinct user presets', async () => {
      const { listTeamPresets, saveTeamPreset } = await loadTeamsModule()

      saveTeamPreset(makeUserPreset({ id: TeamConfigId('user-1'), name: 'Team Alpha' }))
      saveTeamPreset(makeUserPreset({ id: TeamConfigId('user-2'), name: 'Team Beta' }))

      const userPresets = listTeamPresets().filter((preset) => !preset.isBuiltIn)
      expect(userPresets).toHaveLength(2)
    })
  })

  describe('deleteTeamPreset', () => {
    it('removes a previously saved user preset', async () => {
      const { deleteTeamPreset, listTeamPresets, saveTeamPreset } = await loadTeamsModule()
      saveTeamPreset(makeUserPreset({ id: TeamConfigId('to-delete') }))

      deleteTeamPreset('to-delete')

      expect(listTeamPresets().find((preset) => preset.id === 'to-delete')).toBeUndefined()
    })

    it('does not affect other user presets when one is deleted', async () => {
      const { deleteTeamPreset, listTeamPresets, saveTeamPreset } = await loadTeamsModule()
      saveTeamPreset(makeUserPreset({ id: TeamConfigId('keep-me'), name: 'Keep' }))
      saveTeamPreset(makeUserPreset({ id: TeamConfigId('remove-me'), name: 'Remove' }))

      deleteTeamPreset('remove-me')

      const all = listTeamPresets()
      expect(all.find((preset) => preset.id === 'keep-me')).toBeDefined()
      expect(all.find((preset) => preset.id === 'remove-me')).toBeUndefined()
    })

    it('leaves built-in presets intact after deleting a user preset', async () => {
      const { deleteTeamPreset, listTeamPresets, saveTeamPreset } = await loadTeamsModule()
      saveTeamPreset(makeUserPreset())

      deleteTeamPreset('user-preset-1')

      const ids = listTeamPresets().map((preset) => preset.id)
      for (const builtInId of BUILT_IN_IDS) {
        expect(ids).toContain(builtInId)
      }
    })
  })
})
