import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SupportedModelId, WagglePresetId } from '@shared/types/brand'
import type { WagglePreset } from '@shared/types/waggle'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  userDataDir: '',
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => state.userDataDir,
  },
}))

import { clearConfigCache, loadProjectConfig } from '../../config/project-config'
import {
  WagglePresetsRepository,
  type WagglePresetsRepositoryShape,
} from '../../ports/waggle-presets-repository'
import { SettingsWagglePresetsRepositoryLive } from '../settings-waggle-presets-repository'

function createPreset(input: {
  readonly id: string
  readonly name: string
  readonly updatedAt?: number
}): WagglePreset {
  return {
    id: WagglePresetId(input.id),
    name: input.name,
    description: `${input.name} preset`,
    config: {
      mode: 'sequential',
      agents: [
        {
          label: 'Architect',
          model: SupportedModelId('openai/gpt-5.4'),
          roleDescription: 'Plans the implementation',
          color: 'blue',
        },
        {
          label: 'Reviewer',
          model: SupportedModelId('anthropic/claude-sonnet-4-5'),
          roleDescription: 'Reviews the implementation',
          color: 'amber',
        },
      ],
      stop: { primary: 'consensus', maxTurnsSafety: 8 },
    },
    isBuiltIn: false,
    createdAt: 100,
    updatedAt: input.updatedAt ?? 100,
  }
}

function runWithRepository<A>(
  useRepository: (repository: WagglePresetsRepositoryShape) => Effect.Effect<A>,
): Promise<A> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const repository = yield* WagglePresetsRepository
      return yield* useRepository(repository)
    }).pipe(Effect.provide(SettingsWagglePresetsRepositoryLive)),
  )
}

describe('SettingsWagglePresetsRepositoryLive', () => {
  let tmpRoot = ''
  let projectPath = ''

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-waggle-presets-'))
    state.userDataDir = path.join(tmpRoot, 'user-data')
    projectPath = path.join(tmpRoot, 'project')
    await fs.mkdir(projectPath, { recursive: true })
    clearConfigCache()
  })

  afterEach(async () => {
    clearConfigCache()
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('lists built-in presets when no user or project presets exist', async () => {
    const presets = await runWithRepository((repository) => repository.list(projectPath))

    expect(presets.map((preset) => preset.id)).toContain(WagglePresetId('builtin-code-review'))
    expect(presets.map((preset) => preset.name)).toContain('Code Review')
  })

  it('persists global presets in user data when no project path is provided', async () => {
    const globalPreset = createPreset({ id: 'custom-review', name: 'Global Review' })

    await runWithRepository((repository) => repository.save(globalPreset))
    const presets = await runWithRepository((repository) => repository.list(null))

    expect(presets.find((preset) => preset.id === globalPreset.id)?.name).toBe('Global Review')
  })

  it('persists project presets in .openwaggle/settings.json', async () => {
    const projectPreset = createPreset({ id: 'project-review', name: 'Project Review' })

    await runWithRepository((repository) => repository.save(projectPreset, projectPath))

    const config = await loadProjectConfig(projectPath)
    expect(config.wagglePresets?.map((preset) => preset.name)).toEqual(['Project Review'])
  })

  it('prefers project presets over global presets with the same id', async () => {
    const globalPreset = createPreset({ id: 'shared-review', name: 'Global Review' })
    const projectPreset = createPreset({
      id: 'shared-review',
      name: 'Project Review',
      updatedAt: 200,
    })

    await runWithRepository((repository) => repository.save(globalPreset))
    await runWithRepository((repository) => repository.save(projectPreset, projectPath))

    const projectPresets = await runWithRepository((repository) => repository.list(projectPath))
    const globalPresets = await runWithRepository((repository) => repository.list(null))

    expect(projectPresets.find((preset) => preset.id === projectPreset.id)?.name).toBe(
      'Project Review',
    )
    expect(globalPresets.find((preset) => preset.id === globalPreset.id)?.name).toBe(
      'Global Review',
    )
    expect(projectPresets.filter((preset) => preset.id === projectPreset.id)).toHaveLength(1)
  })

  it('deletes presets from the requested scope only', async () => {
    const globalPreset = createPreset({ id: 'delete-review', name: 'Global Review' })
    const projectPreset = createPreset({ id: 'delete-review', name: 'Project Review' })

    await runWithRepository((repository) => repository.save(globalPreset))
    await runWithRepository((repository) => repository.save(projectPreset, projectPath))
    await runWithRepository((repository) => repository.delete(projectPreset.id, projectPath))

    const projectPresets = await runWithRepository((repository) => repository.list(projectPath))
    const globalPresets = await runWithRepository((repository) => repository.list(null))

    expect(projectPresets.find((preset) => preset.id === projectPreset.id)?.name).toBe(
      'Global Review',
    )
    expect(globalPresets.find((preset) => preset.id === globalPreset.id)?.name).toBe(
      'Global Review',
    )
  })
})
