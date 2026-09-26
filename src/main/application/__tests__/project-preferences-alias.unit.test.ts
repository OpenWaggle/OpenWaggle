import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../agent-loop-authorization-grants', () => ({
  grantPendingAuthorizationsWhereFullAccess: vi.fn(),
}))

vi.mock('../agent-authorization-mode', () => ({
  resolveEffectiveAuthorizationMode: vi.fn(),
}))

import { DEFAULT_SETTINGS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import { SettingsService } from '../../services/settings-service'
import { removeProjectModelOperation } from '../project-model-removal-operation'
import {
  getProjectPreferencesOperation,
  setProjectPreferencesOperation,
} from '../project-preferences-operation'

/**
 * Alias-identity tests run with real path validation: canonicalization behavior is exactly what
 * these operations must get right, so the validation module is not mocked here.
 */
describe('project preference operations retain canonical identities for aliases', () => {
  let aliasRecords: Array<[string, string]>
  let aliasRemovals: Array<string>
  let modelWrites: Array<[string, string | null]>
  let removals: Array<string>

  beforeEach(() => {
    aliasRecords = []
    aliasRemovals = []
    modelWrites = []
    removals = []
  })

  const tempProjectPath = async (prefix: string) =>
    fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)))

  const run =
    (operation: (path: string) => Effect.Effect<unknown, Error, SettingsService>) =>
    (path: string) =>
      Effect.runPromise(
        operation(path).pipe(
          Effect.provideService(SettingsService, {
            get: () =>
              Effect.succeed({
                ...DEFAULT_SETTINGS,
                projectPathAliases: Object.fromEntries(aliasRecords),
              }),
            update: () => Effect.succeed(undefined),
            setProjectModel: (projectPath: string, model: string | null) =>
              Effect.sync(() => {
                modelWrites.push([projectPath, model])
              }),
            removeProjectModel: (projectPath: string) =>
              Effect.sync(() => {
                removals.push(projectPath)
              }),
            recordProjectPathAlias: (alias: string, canonicalPath: string) =>
              Effect.sync(() => {
                aliasRecords.push([alias, canonicalPath])
              }),
            resolveProjectPathAlias: (alias: string) =>
              Effect.sync(() => aliasRecords.find(([candidate]) => candidate === alias)?.[1]),
            removeProjectPathAlias: (alias: string) =>
              Effect.sync(() => {
                aliasRemovals.push(alias)
              }),
            initialize: () => Effect.succeed(undefined),
            flushForTests: () => Effect.succeed(undefined),
          }),
        ),
      )

  it('records the alias identity on preference reads and writes', async () => {
    const canonicalPath = await tempProjectPath('openwaggle-alias-')
    const aliasPath = path.join(path.dirname(canonicalPath), `${path.basename(canonicalPath)}-link`)
    await fs.symlink(canonicalPath, aliasPath)

    await run((p) => getProjectPreferencesOperation(p))(aliasPath)
    await run((p) => setProjectPreferencesOperation(p, { model: 'provider/model' }))(aliasPath)

    expect(aliasRecords).toEqual([
      [aliasPath, canonicalPath],
      [aliasPath, canonicalPath],
    ])
    // The model is written under the canonical key, never the alias.
    expect(modelWrites).toEqual([[canonicalPath, 'provider/model']])

    await fs.rm(canonicalPath, { recursive: true, force: true })
    await fs.rm(aliasPath, { force: true })
  })

  it('removes the canonical entry through the recorded alias after the directory is gone', async () => {
    const canonicalPath = await tempProjectPath('openwaggle-alias-')
    const aliasPath = path.join(path.dirname(canonicalPath), `${path.basename(canonicalPath)}-link`)
    await fs.symlink(canonicalPath, aliasPath)
    await fs.rm(canonicalPath, { recursive: true, force: true })
    await fs.rm(aliasPath, { force: true })
    aliasRecords.push([aliasPath, canonicalPath])

    await run((p) => removeProjectModelOperation(p))(aliasPath)

    // The recorded canonical identity is authoritative: exactly that entry is removed.
    expect(removals).toEqual([canonicalPath])
    expect(aliasRemovals).toEqual([aliasPath])

    await fs.rm(canonicalPath, { recursive: true, force: true })
  })

  it('does not touch an unrelated project when a recorded alias was retargeted', async () => {
    const recordedTarget = await tempProjectPath('openwaggle-alias-old-')
    const newTarget = await tempProjectPath('openwaggle-alias-new-')
    const aliasPath = path.join(path.dirname(newTarget), `${path.basename(newTarget)}-link`)
    await fs.symlink(newTarget, aliasPath)
    aliasRecords.push([aliasPath, recordedTarget])

    await run((p) => removeProjectModelOperation(p))(aliasPath)

    // The recorded identity is authoritative: the retargeted symlink's project is untouched.
    expect(removals).toEqual([recordedTarget])

    await fs.rm(recordedTarget, { recursive: true, force: true })
    await fs.rm(newTarget, { recursive: true, force: true })
    await fs.rm(aliasPath, { force: true })
  })
})
