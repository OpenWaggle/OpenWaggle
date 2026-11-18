import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveMode: vi.fn(),
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

vi.mock('../agent-authorization-mode', () => ({
  resolveEffectiveAuthorizationMode: mocks.resolveMode,
}))

import { SessionId } from '@shared/types/brand'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import { SettingsService } from '../../services/settings-service'
import {
  clearAgentLoopInteractionBrokerForTests,
  listPendingAgentLoopInteractions,
  requestAgentLoopInteraction,
} from '../agent-loop-interaction-broker'
import {
  getProjectPreferencesOperation,
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
  let updates: { selectedModelsByProject?: Record<string, string> }[]
  let projectModelWrites: [string, string | null][] | undefined
  let projectModelMigrations: [string, string][] | undefined
  let projectPath: string

  function makeService() {
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
    clearAgentLoopInteractionBrokerForTests()
    mocks.resolveMode.mockReset().mockResolvedValue('ask-for-approval')
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
    const authorization = (sessionId: SessionId) =>
      requestAgentLoopInteraction({
        interaction: {
          interactionId: `authorize-${sessionId}`,
          sessionId,
          runId: 'run-1',
          kind: 'confirm',
          source: 'pi-ui',
          createdAt: 1,
          title: 'Allow?',
          message: 'Allow the tool call?',
          purpose: 'authorization',
        },
        onEvent: () => undefined,
      })
    const fullAccess = SessionId('full-access-session')
    const asking = SessionId('asking-session')
    mocks.resolveMode.mockImplementation((sessionId: SessionId) =>
      Promise.resolve(sessionId === fullAccess ? 'yolo' : 'ask-for-approval'),
    )
    const granted = authorization(fullAccess)
    void authorization(asking)

    await run(setProjectPreferencesOperation('/project', { authorizationMode: 'yolo' }))

    expect(mocks.setPreferences).toHaveBeenCalledWith('/project', {
      authorizationMode: 'yolo',
    })
    await expect(granted).resolves.toEqual({ kind: 'confirm', accepted: true })
    expect(listPendingAgentLoopInteractions()).toMatchObject([{ sessionId: asking }])
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

  it('never stores a thinking level as a project preference', async () => {
    await expect(
      run(setProjectPreferencesOperation('/project', { thinkingLevel: 'high' })),
    ).resolves.toBe('/project')

    expect(updates).toEqual([])
    expect(mocks.setPreferences).not.toHaveBeenCalled()
  })

  it('clears the DB model entry without touching the file when no legacy model exists', async () => {
    storedModels = { '/project': 'openai/gpt-4.1' }

    await run(setProjectPreferencesOperation('/project', { model: null }))

    // The clear writes an empty-string tombstone so a stale legacy migration cannot resurrect it.
    expect(updates).toEqual([{ selectedModelsByProject: { '/project': '' } }])
    // The file holds no legacy model, so the selected model is DB-only and no rewrite is needed.
    expect(mocks.setPreferences).not.toHaveBeenCalled()
  })

  it.each(['openai/gpt-4.1', null])(
    'rewrites the file to shed a legacy model when the model is set to %s',
    async (model) => {
      projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-legacy-model-'))
      await writeLegacyModelFile(projectPath)

      await run(setProjectPreferencesOperation(projectPath, { model }))

      // A model-only set must still rewrite the file so the repo sheds the stale legacy value.
      expect(mocks.setPreferences).toHaveBeenCalledWith(projectPath, {})
    },
  )

  it('migrates a legacy file model to the DB before an unrelated write strips it', async () => {
    projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-legacy-model-'))
    await writeLegacyModelFile(projectPath)
    projectModelMigrations = []

    await run(
      setProjectPreferencesOperation(projectPath, { authorizationMode: 'ask-for-approval' }),
    )

    // The legacy override must survive the strip: it moves into the DB via the atomic
    // insert-if-absent writer, which never overwrites an existing entry.
    expect(projectModelMigrations).toEqual([[projectPath, 'legacy/file']])
    expect(storedModels).toEqual({ [projectPath]: 'legacy/file' })
    expect(mocks.setPreferences).toHaveBeenCalledWith(projectPath, {
      authorizationMode: 'ask-for-approval',
    })
  })

  it.each([
    { stored: '', reason: 'a cleared override' },
    { stored: 'db/newer', reason: 'a newer DB value' },
  ])('does not overwrite $reason when a stale legacy file read migrates', async ({ stored }) => {
    projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-legacy-model-'))
    await writeLegacyModelFile(projectPath)
    projectModelMigrations = []
    // A queued explicit clear or model write landed when this write's legacy read started.
    storedModels = { [projectPath]: stored }

    await run(
      setProjectPreferencesOperation(projectPath, { authorizationMode: 'ask-for-approval' }),
    )

    // The insert-if-absent writer sees the existing entry and leaves it as it is.
    expect(projectModelMigrations).toEqual([[projectPath, 'legacy/file']])
    expect(storedModels).toEqual({ [projectPath]: stored })
    expect(mocks.setPreferences).toHaveBeenCalledWith(projectPath, {
      authorizationMode: 'ask-for-approval',
    })
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
    await writeSettingsFile({ model: 'legacy/file', authorizationMode: 'yolo' })

    await expect(run(projectPath)).resolves.toEqual({
      model: 'db/provider',
      authorizationMode: 'yolo',
    })
  })

  it('falls back to the legacy file model when the DB has no entry', async () => {
    await writeSettingsFile({ model: 'legacy/file' })

    await expect(run(projectPath)).resolves.toEqual({ model: 'legacy/file' })
  })

  it('suppresses the legacy file model when a clear tombstone exists', async () => {
    storedModels = { [projectPath]: '' }
    await writeSettingsFile({ model: 'legacy/file', authorizationMode: 'yolo' })

    // The tombstone is presence-checked, not truthiness-checked: the cleared override must not
    // fall back to the legacy file value.
    await expect(run(projectPath)).resolves.toEqual({ authorizationMode: 'yolo' })
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
