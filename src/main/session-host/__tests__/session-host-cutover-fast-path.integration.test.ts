import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runSessionHostCutover } from '../session-host-cutover'
import { fakeEmbeddingModel, seedLegacyDatabase } from './session-host-cutover-test-support'

function pathsFor(root: string) {
  return {
    sourceDatabasePath: path.join(root, 'openwaggle.db'),
    targetDatabasePath: path.join(root, 'session-host', 'session-host.sqlite'),
    recoveryDatabasePath: path.join(root, 'openwaggle.pre-session-host-v2.db'),
  }
}

describe('Session Host cutover completion fast path', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-cutover-fast-path-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('trusts the durable completion seal instead of rescanning mutable projections', async () => {
    const paths = pathsFor(temporaryRoot)
    seedLegacyDatabase(paths.sourceDatabasePath)
    await runSessionHostCutover(paths, Date.now(), fakeEmbeddingModel)
    const target = new DatabaseSync(paths.targetDatabasePath)
    try {
      target.exec('DELETE FROM session_title_search')
    } finally {
      target.close()
    }

    await expect(
      runSessionHostCutover(paths, Date.now(), fakeEmbeddingModel),
    ).resolves.toMatchObject({ status: 'already-complete' })
  })

  it('fails closed without replacing an active target whose completion seal is invalid', async () => {
    const paths = pathsFor(temporaryRoot)
    seedLegacyDatabase(paths.sourceDatabasePath)
    await runSessionHostCutover(paths, Date.now(), fakeEmbeddingModel)
    const target = new DatabaseSync(paths.targetDatabasePath)
    try {
      target.exec("UPDATE session_host_schema_metadata SET migration_revision = 'incomplete'")
    } finally {
      target.close()
    }

    await expect(runSessionHostCutover(paths, Date.now(), fakeEmbeddingModel)).rejects.toThrow(
      'completion metadata is missing or incompatible',
    )
    await expect(fs.access(paths.targetDatabasePath)).resolves.toBeUndefined()
    await expect(fs.access(paths.recoveryDatabasePath)).resolves.toBeUndefined()
    await expect(fs.access(paths.sourceDatabasePath)).rejects.toThrow()
  })

  it('fully validates a staged recovery target before promoting it', async () => {
    const paths = pathsFor(temporaryRoot)
    const stagingPath = `${paths.targetDatabasePath}.partial`
    seedLegacyDatabase(paths.sourceDatabasePath)
    await runSessionHostCutover(paths, Date.now(), fakeEmbeddingModel)
    await fs.rename(paths.targetDatabasePath, stagingPath)
    const staging = new DatabaseSync(stagingPath)
    try {
      staging.exec('DELETE FROM session_workspace_bindings')
    } finally {
      staging.close()
    }

    await expect(runSessionHostCutover(paths, Date.now(), fakeEmbeddingModel)).rejects.toThrow(
      'Every migrated Session must have one Workspace binding',
    )
    await expect(fs.access(paths.targetDatabasePath)).rejects.toThrow()
    await expect(fs.access(stagingPath)).rejects.toThrow()
    await expect(fs.access(paths.recoveryDatabasePath)).resolves.toBeUndefined()
  })
})
