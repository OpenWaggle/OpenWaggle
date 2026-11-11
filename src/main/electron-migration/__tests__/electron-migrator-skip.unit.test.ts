import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { temporaryTestDirectory } from '../../test-support/temporary-test-directory'
import { runElectronMigration, skipMigrationStep } from '../electron-migrator'
import {
  initialMigrationState,
  readMigrationState,
  withStep,
  writeMigrationState,
} from '../migration-state'

const directLock = <T>(operation: () => Promise<T>) => operation()
const NOW = new Date('2026-11-11T00:00:00.000Z')

async function stateWithBlockedSecrets() {
  const userData = path.join(await temporaryTestDirectory('ow-migration-skip-'), 'openwaggle')
  const initial = initialMigrationState(NOW, true)
  const blocked = withStep(initial, 'secrets', { status: 'blocked', error: 'denied' }, NOW, true)
  await writeMigrationState(userData, blocked)
  return { userData, withLock: directLock, now: () => NOW }
}

describe('skipMigrationStep', () => {
  it('makes a blocked secrets step final when the user will enter them again', async () => {
    const options = await stateWithBlockedSecrets()
    const skipped = await skipMigrationStep(options, 'secrets')
    expect(skipped?.steps.secrets).toMatchObject({
      status: 'not-needed',
      detail: { skippedByUser: true },
    })
    expect(await readMigrationState(options.userData)).toEqual(skipped)
  })

  it('keeps a finished step finished and records the choice', async () => {
    const options = await stateWithBlockedSecrets()
    const state = await readMigrationState(options.userData)
    if (!state) throw new Error('no state')
    const files = [{ file: 'mcp/vault.json', unrecoverable: ['TOKEN'] }]
    const done = withStep(state, 'secrets', { status: 'done', detail: { files } }, NOW, true)
    await writeMigrationState(options.userData, done)
    const skipped = await skipMigrationStep(options, 'secrets')
    expect(skipped?.steps.secrets).toMatchObject({
      status: 'done',
      detail: { files, skippedByUser: true },
    })
  })

  it('does nothing without a migration state', async () => {
    const userData = await temporaryTestDirectory('ow-migration-skip-empty-')
    await expect(
      skipMigrationStep({ userData, withLock: directLock }, 'secrets'),
    ).resolves.toBeUndefined()
  })
})

describe('the Electron install a first launch finds', () => {
  it("does not take the Electrobun build's own session-data directory for one", async () => {
    const userData = path.join(await temporaryTestDirectory('ow-migration-fresh-'), 'openwaggle')
    await mkdir(path.join(userData, 'session-data'), { recursive: true })
    const report = await runElectronMigration({
      userData,
      sharedMcpDirectory: path.join(userData, 'shared-mcp'),
      codec: { decryptLegacy: async () => '', seal: async () => Buffer.alloc(0) },
      withLock: directLock,
    })
    expect(report.state.fromElectron).toBe(false)
  })

  it('finds one from what Chromium leaves in the profile', async () => {
    const userData = path.join(await temporaryTestDirectory('ow-migration-electron-'), 'openwaggle')
    await mkdir(path.join(userData, 'session-data'), { recursive: true })
    await writeFile(path.join(userData, 'session-data', 'Local State'), '{}')
    const report = await runElectronMigration({
      userData,
      sharedMcpDirectory: path.join(userData, 'shared-mcp'),
      codec: { decryptLegacy: async () => '', seal: async () => Buffer.alloc(0) },
      withLock: directLock,
      steps: [],
    })
    expect(report.state.fromElectron).toBe(true)
  })
})
