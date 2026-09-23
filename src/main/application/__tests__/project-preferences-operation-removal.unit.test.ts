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

  beforeEach(() => {
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

  it('rejects relative paths without touching stored settings', async () => {
    await expect(run('relative/path')).rejects.toThrow('Project path is required.')
    expect(removals).toEqual([])
    expect(mocks.setPreferences).not.toHaveBeenCalled()
  })
})
