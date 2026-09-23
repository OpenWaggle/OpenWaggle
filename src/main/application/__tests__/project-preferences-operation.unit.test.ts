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
    validateRequiredProjectPath: (projectPath: string | null) =>
      EffectModule.succeed(projectPath ?? ''),
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
  removeProjectModelOperation,
  setProjectPreferencesOperation,
} from '../project-preferences-operation'

async function writeLegacyModelFile(projectPath: string) {
  await fs.mkdir(path.join(projectPath, '.openwaggle'), { recursive: true })
  await fs.writeFile(
    path.join(projectPath, '.openwaggle', 'settings.json'),
    JSON.stringify({ preferences: { model: 'legacy/file' } }),
    'utf-8',
  )
}

describe('Host-backed project preferences', () => {
  let storedModels: Record<string, string>
  let updates: Array<{ selectedModelsByProject?: Record<string, string> }>
  let projectModelWrites: Array<[string, string | null]> | undefined
  let projectModelMigrations: Array<[string, string]> | undefined
  let projectPath: string

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
            setProjectModel: (writtenPath: string, model: string | null) =>
              Effect.sync(() => {
                projectModelWrites?.push([writtenPath, model])
              }),
          }
        : {}),
      ...(projectModelMigrations
        ? {
            migrateProjectModel: (migrationPath: string, model: string) =>
              Effect.sync(() => {
                projectModelMigrations?.push([migrationPath, model])
                // Mirrors the queue-safe store writer: insert only while no entry exists.
                if (!Object.hasOwn(storedModels, migrationPath)) {
                  storedModels = { ...storedModels, [migrationPath]: model }
                  return true
                }
                return false
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
    projectModelMigrations = undefined
    projectPath = '/project'
  })

  afterEach(async () => {
    if (projectPath.startsWith(os.tmpdir())) {
      await fs.rm(projectPath, { recursive: true, force: true })
    }
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

  it('strips a legacy file model when an explicit model replaces it', async () => {
    projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-legacy-model-'))
    await writeLegacyModelFile(projectPath)

    await run(setProjectPreferencesOperation(projectPath, { model: 'openai/gpt-4.1' }))

    // A model-only set must still rewrite the file so the repo sheds the stale legacy value.
    expect(mocks.setPreferences).toHaveBeenCalledWith(projectPath, {})
  })

  it('still persists thinkingLevel in the project settings file', async () => {
    await run(setProjectPreferencesOperation('/project', { thinkingLevel: 'high' }))

    expect(updates).toEqual([])
    expect(mocks.setPreferences).toHaveBeenCalledWith('/project', { thinkingLevel: 'high' })
  })

  it('clears the DB model entry without touching the file when no legacy model exists', async () => {
    storedModels = { '/project': 'openai/gpt-4.1' }

    await run(setProjectPreferencesOperation('/project', { model: null }))

    // The clear writes an empty-string tombstone so a stale legacy migration cannot resurrect it.
    expect(updates).toEqual([{ selectedModelsByProject: { '/project': '' } }])
    // The file holds no legacy model, so the selected model is DB-only and no rewrite is needed.
    expect(mocks.setPreferences).not.toHaveBeenCalled()
  })

  it('rewrites the file on an explicit clear when the file still carries a legacy model', async () => {
    projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-legacy-model-'))
    await writeLegacyModelFile(projectPath)

    await run(setProjectPreferencesOperation(projectPath, { model: null }))

    expect(mocks.setPreferences).toHaveBeenCalledWith(projectPath, {})
  })

  it('migrates a legacy file model to the DB before an unrelated write strips it', async () => {
    projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-legacy-model-'))
    await writeLegacyModelFile(projectPath)
    projectModelMigrations = []

    await run(setProjectPreferencesOperation(projectPath, { thinkingLevel: 'high' }))

    // The legacy override must survive the strip: it moves into the DB via the atomic
    // insert-if-absent writer, which never overwrites an existing entry.
    expect(projectModelMigrations).toEqual([[projectPath, 'legacy/file']])
    expect(storedModels).toEqual({ [projectPath]: 'legacy/file' })
    expect(mocks.setPreferences).toHaveBeenCalledWith(projectPath, { thinkingLevel: 'high' })
  })

  it('does not resurrect a cleared override when a stale legacy file read migrates', async () => {
    projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-legacy-model-'))
    await writeLegacyModelFile(projectPath)
    projectModelMigrations = []
    // A queued explicit clear already wrote its tombstone when this write's legacy read started.
    storedModels = { [projectPath]: '' }

    await run(setProjectPreferencesOperation(projectPath, { thinkingLevel: 'high' }))

    // The insert-if-absent writer sees the tombstone and leaves the cleared override cleared.
    expect(projectModelMigrations).toEqual([[projectPath, 'legacy/file']])
    expect(storedModels).toEqual({ [projectPath]: '' })
  })

  it('does not overwrite a newer DB value when migrating a legacy file model', async () => {
    projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-legacy-model-'))
    storedModels = { [projectPath]: 'db/newer' }
    await writeLegacyModelFile(projectPath)
    projectModelMigrations = []

    await run(setProjectPreferencesOperation(projectPath, { thinkingLevel: 'high' }))

    expect(storedModels).toEqual({ [projectPath]: 'db/newer' })
    expect(mocks.setPreferences).toHaveBeenCalledWith(projectPath, { thinkingLevel: 'high' })
  })
})

describe('removeProjectModelOperation', () => {
  let removals: Array<string> | undefined

  beforeEach(() => {
    mocks.grantPending.mockReset().mockResolvedValue(undefined)
    mocks.setPreferences.mockReset().mockResolvedValue(undefined)
    removals = []
  })

  const run = (rawProjectPath: unknown) =>
    Effect.runPromise(
      removeProjectModelOperation(rawProjectPath).pipe(
        Effect.provideService(SettingsService, {
          get: () => Effect.succeed(DEFAULT_SETTINGS),
          update: () => Effect.succeed(undefined),
          ...(removals
            ? {
                removeProjectModel: (projectPath: string) =>
                  Effect.sync(() => {
                    removals?.push(projectPath)
                  }),
              }
            : {}),
          initialize: () => Effect.succeed(undefined),
          flushForTests: () => Effect.succeed(undefined),
        }),
      ),
    )

  it('deletes the stored model through the queue-safe backend writer', async () => {
    await run('/project')

    expect(removals).toEqual(['/project'])
  })

  it('strips a legacy file model before deleting the entry', async () => {
    const legacyPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-legacy-model-'))
    await writeLegacyModelFile(legacyPath)

    await run(legacyPath)

    // The file rewrite strips the legacy value (the central write migrates it first), then the
    // DB entry is deleted, so re-adding the project starts fresh instead of resurrecting it.
    expect(mocks.setPreferences).toHaveBeenCalledWith(legacyPath, {})
    expect(removals).toEqual([legacyPath])
    await fs.rm(legacyPath, { recursive: true, force: true })
  })

  it('does not rewrite the project file when it holds no legacy model', async () => {
    const plainPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-legacy-model-'))

    await run(plainPath)

    expect(mocks.setPreferences).not.toHaveBeenCalled()
    expect(removals).toEqual([plainPath])
    await fs.rm(plainPath, { recursive: true, force: true })
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

  it('suppresses the legacy file model when a clear tombstone exists', async () => {
    storedModels = { [projectPath]: '' }
    await writeSettingsFile({ model: 'legacy/file', thinkingLevel: 'high' })

    // The tombstone is presence-checked, not truthiness-checked: the cleared override must not
    // fall back to the legacy file value.
    await expect(run(projectPath)).resolves.toEqual({ thinkingLevel: 'high' })
  })

  it('returns null when a tombstone exists and the file carries only a legacy model', async () => {
    storedModels = { [projectPath]: '' }
    await writeSettingsFile({ model: 'legacy/file' })

    await expect(run(projectPath)).resolves.toBeNull()
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
