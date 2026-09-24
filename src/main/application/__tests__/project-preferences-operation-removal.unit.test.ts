import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
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
  grantPendingAuthorizationsWhereFullAccess: vi.fn(),
}))

vi.mock('../agent-authorization-mode', () => ({
  resolveEffectiveAuthorizationMode: vi.fn(),
}))

import { DEFAULT_SETTINGS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import { SettingsService } from '../../services/settings-service'
import { removeProjectModelOperation } from '../project-preferences-operation'

async function writeLegacyModelFile(projectPath: string) {
  await fs.mkdir(path.join(projectPath, '.openwaggle'), { recursive: true })
  await fs.writeFile(
    path.join(projectPath, '.openwaggle', 'settings.json'),
    JSON.stringify({ preferences: { model: 'legacy/file' } }),
    'utf-8',
  )
}

describe('removeProjectModelOperation', () => {
  let removals: Array<string> | undefined
  let modelWrites: Array<[string, string | null]> | undefined

  beforeEach(() => {
    mocks.setPreferences.mockReset().mockResolvedValue(undefined)
    removals = []
    modelWrites = []
  })

  const run = (rawProjectPath: unknown, serviceOverrides: Record<string, unknown> = {}) =>
    Effect.runPromise(
      removeProjectModelOperation(rawProjectPath).pipe(
        Effect.provideService(SettingsService, {
          get: () => Effect.succeed(DEFAULT_SETTINGS),
          update: () => Effect.succeed(undefined),
          setProjectModel: (projectPath: string, model: string | null) =>
            Effect.sync(() => {
              modelWrites?.push([projectPath, model])
            }),
          removeProjectModel: (projectPath: string) =>
            Effect.sync(() => {
              removals?.push(projectPath)
            }),
          initialize: () => Effect.succeed(undefined),
          flushForTests: () => Effect.succeed(undefined),
          ...serviceOverrides,
        }),
      ),
    )

  const tempProjectPath = async (prefix: string) =>
    fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)))

  it('deletes the stored model through the queue-safe backend writer', async () => {
    await run('/project')

    expect(removals).toEqual(['/project'])
  })

  it('strips a legacy file model before deleting the entry', async () => {
    const legacyPath = await tempProjectPath('openwaggle-legacy-model-')
    await writeLegacyModelFile(legacyPath)

    await run(legacyPath)

    // The file rewrite strips the legacy value (the central write migrates it first), then the
    // DB entry is deleted, so re-adding the project starts fresh instead of resurrecting it.
    expect(mocks.setPreferences).toHaveBeenCalledWith(legacyPath, {})
    expect(removals).toEqual([legacyPath])
    await fs.rm(legacyPath, { recursive: true, force: true })
  })

  it('does not rewrite the project file when it holds no legacy model', async () => {
    const plainPath = await tempProjectPath('openwaggle-legacy-model-')

    await run(plainPath)

    expect(mocks.setPreferences).not.toHaveBeenCalled()
    expect(removals).toEqual([plainPath])
    await fs.rm(plainPath, { recursive: true, force: true })
  })

  it('removes the entry when the project directory no longer exists', async () => {
    const gonePath = await tempProjectPath('openwaggle-legacy-model-')
    await fs.rm(gonePath, { recursive: true, force: true })

    await run(gonePath)

    expect(mocks.setPreferences).not.toHaveBeenCalled()
    expect(removals).toEqual([gonePath])
  })

  it('tombstones the entry when the settings file is unreadable', async () => {
    const lockedPath = await tempProjectPath('openwaggle-legacy-model-')
    await writeLegacyModelFile(lockedPath)
    await fs.chmod(path.join(lockedPath, '.openwaggle', 'settings.json'), 0o000)

    await run(lockedPath)

    // The legacy value cannot be proven absent, so the tombstone must suppress the file fallback
    // until the file can be retired.
    expect(modelWrites).toEqual([[lockedPath, null]])
    expect(removals).toEqual([])
    await fs.chmod(path.join(lockedPath, '.openwaggle', 'settings.json'), 0o644)
    await fs.rm(lockedPath, { recursive: true, force: true })
  })

  it('tombstones the entry when the legacy rewrite fails', async () => {
    const legacyPath = await tempProjectPath('openwaggle-legacy-model-')
    await writeLegacyModelFile(legacyPath)
    mocks.setPreferences.mockRejectedValue(new Error('read-only media'))

    await run(legacyPath)

    // The failed rewrite may have migrated the legacy value into the DB and the file still holds
    // it, so the tombstone must suppress both instead of a plain delete.
    expect(modelWrites).toEqual([[legacyPath, null]])
    expect(removals).toEqual([])
    await fs.rm(legacyPath, { recursive: true, force: true })
  })

  it('falls back to direct map updates without the queue-safe writers', async () => {
    const gonePath = await tempProjectPath('openwaggle-legacy-model-')
    await fs.rm(gonePath, { recursive: true, force: true })
    const updates: Array<Record<string, unknown>> = []

    await run(gonePath, {
      setProjectModel: undefined,
      removeProjectModel: undefined,
      update: (patch: Record<string, unknown>) =>
        Effect.sync(() => {
          updates.push(patch)
        }),
    })

    expect(updates).toEqual([{ selectedModelsByProject: {} }])
    expect(modelWrites).toEqual([])
    expect(removals).toEqual([])
  })

  it('rejects relative paths without touching stored settings', async () => {
    await expect(run('relative/path')).rejects.toThrow('Project path is required.')
    expect(removals).toEqual([])
    expect(mocks.setPreferences).not.toHaveBeenCalled()
  })
})
