import type { ElectronMigrationReport } from '../electron-migrator'
import type { MigrationState, MigrationStepState } from '../migration-state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const migration = vi.hoisted(() => ({
  run: vi.fn<(run?: unknown) => Promise<ElectronMigrationReport>>(),
  acknowledge: vi.fn<(importId: string) => Promise<MigrationState | null>>(),
  skip: vi.fn<(step: string) => Promise<MigrationState | null>>(),
  packaged: false,
}))

vi.mock('../../adapters/electrobun/electrobun-electron-migration', () => ({
  runElectrobunFirstLaunchMigration: migration.run,
  acknowledgeElectrobunLocalStorageImport: migration.acknowledge,
  skipElectrobunMigrationStep: migration.skip,
}))
vi.mock('../../desktop-shell/app-lifecycle', () => ({
  appLifecycle: { isPackaged: () => migration.packaged },
}))

const AT = '2026-11-11T00:00:00.000Z'

function step(status: MigrationStepState['status'], extra: Partial<MigrationStepState> = {}) {
  return { status, attempts: 0, updatedAt: AT, ...extra }
}

function stateWith(secrets: MigrationStepState, fromElectron = true): MigrationState {
  return {
    version: 1,
    createdAt: AT,
    updatedAt: AT,
    fromElectron,
    steps: {
      'local-storage': step('done'),
      secrets,
      'browser-preview-reset': step('done'),
    },
  }
}

async function loadFirstLaunch() {
  vi.resetModules()
  return import('../first-launch')
}

const originalPlatform = process.platform

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

describe('first-launch migration', () => {
  beforeEach(() => {
    migration.run.mockReset()
    migration.acknowledge.mockReset()
    migration.skip.mockReset()
    migration.packaged = false
    setPlatform('darwin')
  })

  afterEach(() => setPlatform(originalPlatform))

  it('asks before the secrets step in an unpackaged macOS build', async () => {
    migration.run.mockResolvedValue({ state: stateWith(step('pending')) })
    const firstLaunch = await loadFirstLaunch()
    await firstLaunch.startFirstLaunchMigration()
    expect(migration.run).toHaveBeenCalledWith({
      steps: ['local-storage', 'browser-preview-reset'],
    })
    expect(await firstLaunch.electronMigrationNotice()).toMatchObject({ secrets: 'needs-consent' })
  })

  it('runs every step without asking in a packaged build', async () => {
    migration.packaged = true
    migration.run.mockResolvedValue({ state: stateWith(step('done', { detail: { files: [] } })) })
    const firstLaunch = await loadFirstLaunch()
    await firstLaunch.startFirstLaunchMigration()
    expect(migration.run).toHaveBeenCalledWith({
      steps: ['local-storage', 'secrets', 'browser-preview-reset'],
    })
    expect(await firstLaunch.electronMigrationNotice()).toBeNull()
  })

  it('shows nothing for an install that never ran the Electron build', async () => {
    migration.run.mockResolvedValue({ state: stateWith(step('not-needed'), false) })
    const firstLaunch = await loadFirstLaunch()
    await firstLaunch.startFirstLaunchMigration()
    expect(await firstLaunch.electronMigrationNotice()).toBeNull()
  })

  it('lists the secrets no key opened', async () => {
    const files = [{ file: 'mcp/vault.json', unrecoverable: ['GITHUB_TOKEN', 'LINEAR_KEY'] }]
    migration.run.mockResolvedValue({ state: stateWith(step('done', { detail: { files } })) })
    const firstLaunch = await loadFirstLaunch()
    await firstLaunch.startFirstLaunchMigration()
    expect(await firstLaunch.electronMigrationNotice()).toEqual({
      secrets: 'unrecoverable',
      unrecoverable: ['GITHUB_TOKEN', 'LINEAR_KEY'],
      error: null,
      busy: false,
    })
  })

  it('runs only the secrets step past the attempt cap when the user continues', async () => {
    migration.run.mockResolvedValueOnce({ state: stateWith(step('pending')) })
    migration.run.mockResolvedValueOnce({
      state: stateWith(step('blocked', { error: 'The keychain item did not answer in time' })),
    })
    const firstLaunch = await loadFirstLaunch()
    await firstLaunch.startFirstLaunchMigration()
    expect(await firstLaunch.continueElectronSecretsMigration()).toMatchObject({
      secrets: 'blocked',
      error: 'The keychain item did not answer in time',
    })
    expect(migration.run).toHaveBeenLastCalledWith({ steps: ['secrets'], userRequested: true })
  })

  it('stops asking once the user skips', async () => {
    migration.run.mockResolvedValue({ state: stateWith(step('pending')) })
    migration.skip.mockResolvedValue(
      stateWith(step('not-needed', { detail: { skippedByUser: true } })),
    )
    const firstLaunch = await loadFirstLaunch()
    await firstLaunch.startFirstLaunchMigration()
    expect(await firstLaunch.skipElectronSecretsMigration()).toBeNull()
    expect(migration.skip).toHaveBeenCalledWith('secrets')
  })

  it('hands a pending localStorage import to the window once, until it is acknowledged', async () => {
    const localStorageImport = { importId: 'import-1', entries: { theme: 'dark' } }
    migration.run.mockResolvedValue({ state: stateWith(step('done')), localStorageImport })
    migration.acknowledge.mockResolvedValue(stateWith(step('done')))
    const firstLaunch = await loadFirstLaunch()
    await firstLaunch.firstLaunchMigrationBeforeWindow()
    expect(firstLaunch.electronMigrationRendererArguments()).toEqual([
      `--openwaggle-electron-local-storage-import=${JSON.stringify(localStorageImport)}`,
    ])
    await firstLaunch.acknowledgeFirstLaunchLocalStorageImport('another-import')
    expect(migration.acknowledge).not.toHaveBeenCalled()
    await firstLaunch.acknowledgeFirstLaunchLocalStorageImport('import-1')
    expect(migration.acknowledge).toHaveBeenCalledWith('import-1')
    expect(firstLaunch.electronMigrationRendererArguments()).toEqual([])
  })

  it('never throws when the migration itself fails', async () => {
    migration.run.mockRejectedValue(new Error('locked'))
    const firstLaunch = await loadFirstLaunch()
    await expect(firstLaunch.startFirstLaunchMigration()).resolves.toBeUndefined()
    expect(await firstLaunch.electronMigrationNotice()).toBeNull()
  })
})
