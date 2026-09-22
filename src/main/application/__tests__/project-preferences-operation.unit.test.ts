import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  grantPending: vi.fn(),
  setPreferences: vi.fn(),
}))

vi.mock('../../config/project-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/project-config')>()
  return { ...actual, setProjectPreferences: mocks.setPreferences }
})

vi.mock('../../utils/project-path-validation', async () => {
  const EffectModule = await import('effect/Effect')
  return {
    validateProjectPath: (projectPath: string | null) => EffectModule.succeed(projectPath),
  }
})

vi.mock('../agent-loop-authorization-grants', () => ({
  grantPendingAuthorizationsWhereFullAccess: mocks.grantPending,
}))

vi.mock('../agent-authorization-mode', () => ({
  resolveEffectiveAuthorizationMode: vi.fn(),
}))

import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import { SettingsService, type SettingsServiceShape } from '../../services/settings-service'
import {
  getProjectPreferencesOperation,
  setProjectPreferencesOperation,
} from '../project-preferences-operation'

describe('Host-backed project preferences', () => {
  let storedModels: Record<string, string>
  let updates: Array<{ selectedModelsByProject?: Record<string, string> }>
  let projectModelWrites: Array<[string, string | null]> | undefined

  function makeService(): SettingsServiceShape {
    return {
      get: () =>
        Effect.succeed({ ...DEFAULT_SETTINGS, selectedModelsByProject: { ...storedModels } }),
      update: (partial: Partial<Settings>) =>
        Effect.sync(() => {
          updates.push(partial)
          if (partial.selectedModelsByProject) storedModels = partial.selectedModelsByProject
        }),
      ...(projectModelWrites
        ? {
            setProjectModel: (projectPath: string, model: string | null) =>
              Effect.sync(() => {
                projectModelWrites?.push([projectPath, model])
              }),
          }
        : {}),
      initialize: () => Effect.succeed(undefined),
      flushForTests: () => Effect.succeed(undefined),
    }
  }

  const run = (effect: Effect.Effect<unknown, unknown, SettingsService>) =>
    Effect.runPromise(effect.pipe(Effect.provideService(SettingsService, makeService())))

  beforeEach(() => {
    mocks.grantPending.mockReset().mockResolvedValue(undefined)
    mocks.setPreferences.mockReset().mockResolvedValue(undefined)
    storedModels = {}
    updates = []
    projectModelWrites = undefined
  })

  it('settles authoritative pending prompts after enabling full access', async () => {
    await run(setProjectPreferencesOperation('/project', { authorizationMode: 'yolo' }))

    expect(mocks.setPreferences).toHaveBeenCalledWith('/project', {
      authorizationMode: 'yolo',
    })
    expect(mocks.grantPending).toHaveBeenCalledOnce()
  })

  it('stores the model in the app settings DB, never in the project settings file', async () => {
    storedModels = { '/other': 'other/provider' }

    await run(setProjectPreferencesOperation('/project', { model: 'openai/gpt-4.1' }))

    expect(updates).toEqual([
      { selectedModelsByProject: { '/other': 'other/provider', '/project': 'openai/gpt-4.1' } },
    ])
    // A model-only write must not create or rewrite the repo-local settings file.
    expect(mocks.setPreferences).not.toHaveBeenCalled()
  })

  it('uses the dedicated queue-safe project model writer when the service provides one', async () => {
    projectModelWrites = []

    await run(setProjectPreferencesOperation('/project', { model: 'openai/gpt-4.1' }))

    expect(projectModelWrites).toEqual([['/project', 'openai/gpt-4.1']])
    expect(updates).toEqual([])
    expect(mocks.setPreferences).not.toHaveBeenCalled()
  })

  it('still persists thinkingLevel in the project settings file', async () => {
    await run(setProjectPreferencesOperation('/project', { thinkingLevel: 'high' }))

    expect(updates).toEqual([])
    expect(mocks.setPreferences).toHaveBeenCalledWith('/project', { thinkingLevel: 'high' })
  })

  it('clears the DB model entry when the write passes null', async () => {
    storedModels = { '/project': 'openai/gpt-4.1' }

    await run(setProjectPreferencesOperation('/project', { model: null }))

    expect(updates).toEqual([{ selectedModelsByProject: {} }])
    expect(mocks.setPreferences).not.toHaveBeenCalled()
  })
})

describe('getProjectPreferencesOperation', () => {
  let storedModels: Record<string, string>
  let projectPath: string

  const run = (rawProjectPath: unknown) =>
    Effect.runPromise(
      getProjectPreferencesOperation(rawProjectPath).pipe(
        Effect.provideService(SettingsService, {
          get: () =>
            Effect.succeed({
              ...DEFAULT_SETTINGS,
              selectedModelsByProject: { ...storedModels },
            }),
          update: () => Effect.succeed(undefined),
          initialize: () => Effect.succeed(undefined),
          flushForTests: () => Effect.succeed(undefined),
        }),
      ),
    )

  const writeSettingsFile = async (preferences: unknown) => {
    await fs.mkdir(path.join(projectPath, '.openwaggle'), { recursive: true })
    await fs.writeFile(
      path.join(projectPath, '.openwaggle', 'settings.json'),
      JSON.stringify({ preferences }),
      'utf-8',
    )
  }

  beforeEach(async () => {
    storedModels = {}
    projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-project-prefs-'))
  })

  afterEach(async () => {
    await fs.rm(projectPath, { recursive: true, force: true })
  })

  it('returns the DB model, which wins over a legacy file value', async () => {
    storedModels = { [projectPath]: 'db/provider' }
    await writeSettingsFile({ model: 'legacy/file', thinkingLevel: 'high' })

    await expect(run(projectPath)).resolves.toEqual({
      model: 'db/provider',
      thinkingLevel: 'high',
    })
  })

  it('falls back to the legacy file model when the DB has no entry', async () => {
    await writeSettingsFile({ model: 'legacy/file' })

    await expect(run(projectPath)).resolves.toEqual({ model: 'legacy/file' })
  })

  it('returns null when neither the file nor the DB has preferences', async () => {
    await expect(run(projectPath)).resolves.toBeNull()
  })

  it('surfaces a corrupt project settings file', async () => {
    await fs.mkdir(path.join(projectPath, '.openwaggle'), { recursive: true })
    await fs.writeFile(
      path.join(projectPath, '.openwaggle', 'settings.json'),
      '{ invalid json',
      'utf-8',
    )

    await expect(run(projectPath)).rejects.toThrow()
  })
})
