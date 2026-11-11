import { createCipheriv } from 'node:crypto'
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { temporaryTestDirectory } from '../../test-support/temporary-test-directory'
import { createElectronSafeStorageReader, deriveCbcKey } from '../electron-safe-storage'
import { acknowledgeLocalStorageImport, runElectronMigration } from '../electron-migrator'
import { createKeychainSealer, isSealedBlob, type KeychainSecrets } from '../keychain-sealer'
import { LOCAL_STORAGE_EXPORT_FILE } from '../local-storage-export'
import { readMigrationState } from '../migration-state'

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'electron-43-local-storage')
const OLD_PASSWORD = 'electron keychain password'

function macBlob(plaintext: string, password = OLD_PASSWORD) {
  const cipher = createCipheriv('aes-128-cbc', deriveCbcKey(password, 1003), Buffer.alloc(16, ' '))
  return Buffer.concat([Buffer.from('v10'), cipher.update(plaintext, 'utf8'), cipher.final()])
}

function memorySecrets(): KeychainSecrets {
  const items = new Map<string, string>()
  return {
    get: async ({ service, name }) => items.get(`${service}\0${name}`) ?? null,
    set: async ({ service, name, value }) => {
      items.set(`${service}\0${name}`, value)
    },
  }
}

const directLock = <T>(operation: () => Promise<T>) => operation()

async function electronInstall() {
  const root = await temporaryTestDirectory('ow-electron-install-')
  const userData = path.join(root, 'openwaggle')
  const sharedMcpDirectory = path.join(root, 'home', '.openwaggle', 'mcp')
  const sessionData = path.join(userData, 'session-data')
  await mkdir(path.join(sessionData, 'Local Storage'), { recursive: true })
  await cp(FIXTURE, path.join(sessionData, 'Local Storage', 'leveldb'), { recursive: true })
  for (const partition of [
    'openwaggle-browser-preview',
    'openwaggle-browser-preview-profile-0123',
    'unrelated',
  ]) {
    await mkdir(path.join(sessionData, 'Partitions', partition), { recursive: true })
    await writeFile(path.join(sessionData, 'Partitions', partition, 'Cookies'), 'cookies')
  }
  await mkdir(path.join(userData, 'mcp'), { recursive: true })
  const vault = {
    version: 1,
    secrets: {
      GITHUB_TOKEN: {
        encryptedValue: macBlob('ghp_example').toString('base64'),
        createdAt: 1,
        updatedAt: 2,
      },
      FOREIGN: {
        encryptedValue: macBlob('other build', 'another key').toString('base64'),
        createdAt: 3,
        updatedAt: 4,
      },
    },
  }
  await writeFile(path.join(userData, 'mcp', 'vault.json'), JSON.stringify(vault))
  const oauth = {
    version: 1,
    encrypted: macBlob('{"states":{"server":{"token":"t"}}}').toString('base64'),
  }
  await writeFile(path.join(userData, 'mcp', 'oauth-states.json'), JSON.stringify(oauth))
  const credentials = path.join(userData, 'session-host', 'profile-credentials')
  await mkdir(credentials, { recursive: true })
  await writeFile(path.join(credentials, 'abc.credential'), macBlob('x'.repeat(43)))
  await mkdir(sharedMcpDirectory, { recursive: true })
  await writeFile(
    path.join(sharedMcpDirectory, 'vault.json'),
    JSON.stringify({ version: 1, secrets: {} }),
  )
  return { userData, sharedMcpDirectory }
}

function migrationOptions(
  install: { userData: string; sharedMcpDirectory: string },
  keychainPassword: () => Promise<string | null> = async () => OLD_PASSWORD,
  secrets: KeychainSecrets = memorySecrets(),
) {
  const reader = createElectronSafeStorageReader({
    platform: 'darwin',
    appName: 'openwaggle',
    readKeychainPassword: keychainPassword,
  })
  const sealer = createKeychainSealer({
    secrets,
    service: 'openwaggle Secret Storage',
    name: 'openwaggle',
    withCreationLock: directLock,
  })
  return {
    ...install,
    codec: { decryptLegacy: reader.decrypt, seal: sealer.seal },
    withLock: directLock,
    sealer,
  }
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

async function vaultBlobs(userData: string) {
  const vault = await readJson(path.join(userData, 'mcp', 'vault.json'))
  if (typeof vault !== 'object' || vault === null || !('secrets' in vault)) throw new Error('vault')
  const secrets = vault.secrets
  if (typeof secrets !== 'object' || secrets === null) throw new Error('vault secrets')
  return Object.fromEntries(
    Object.entries(secrets).map(([name, entry]: [string, unknown]) => {
      if (typeof entry !== 'object' || entry === null || !('encryptedValue' in entry)) {
        throw new Error(name)
      }
      return [name, Buffer.from(String(entry.encryptedValue), 'base64')]
    }),
  )
}

async function exists(target: string) {
  return stat(target).then(
    () => true,
    () => false,
  )
}

describe('runElectronMigration', () => {
  it('migrates an Electron install in place and completes once the renderer acknowledges', async () => {
    const install = await electronInstall()
    const options = migrationOptions(install)
    const report = await runElectronMigration(options)

    expect(report.state.fromElectron).toBe(true)
    expect(report.state.steps.secrets.status).toBe('done')
    expect(report.state.steps['browser-preview-reset'].status).toBe('done')
    expect(report.state.steps['local-storage'].status).toBe('awaiting-renderer')
    expect(report.localStorageImport?.entries).toEqual(
      await readJson(path.join(FIXTURE, 'expected.json')),
    )

    const blobs = await vaultBlobs(install.userData)
    expect(isSealedBlob(blobs['GITHUB_TOKEN'] ?? Buffer.alloc(0))).toBe(true)
    await expect(options.sealer.open(blobs['GITHUB_TOKEN'] ?? Buffer.alloc(0))).resolves.toBe(
      'ghp_example',
    )
    // Sealed by another build's key: kept as it was, reported for re-entry.
    expect(blobs['FOREIGN']?.subarray(0, 3).toString()).toBe('v10')
    expect(JSON.stringify(report.state.steps.secrets.detail)).toContain('FOREIGN')

    const credential = await readFile(
      path.join(install.userData, 'session-host', 'profile-credentials', 'abc.credential'),
    )
    await expect(options.sealer.open(credential)).resolves.toBe('x'.repeat(43))
    const backup = path.join(install.userData, 'electron-migration-backup', 'mcp', 'vault.json')
    // The original, still sealed by the Electron key, is kept for a manual rollback.
    expect(await readFile(backup, 'utf8')).toContain(macBlob('ghp_example').toString('base64'))

    const partitions = path.join(install.userData, 'session-data', 'Partitions')
    expect(await exists(path.join(partitions, 'openwaggle-browser-preview'))).toBe(false)
    expect(await exists(path.join(partitions, 'openwaggle-browser-preview-profile-0123'))).toBe(
      false,
    )
    expect(await exists(path.join(partitions, 'unrelated'))).toBe(true)
    // The Electron localStorage stays, so reinstalling the Electron build still finds it.
    expect(
      await exists(
        path.join(install.userData, 'session-data', 'Local Storage', 'leveldb', 'CURRENT'),
      ),
    ).toBe(true)

    const importId = report.localStorageImport?.importId ?? ''
    const acknowledged = await acknowledgeLocalStorageImport(options, importId)
    expect(acknowledged?.steps['local-storage'].status).toBe('done')
    expect(acknowledged?.completedAt).toBeDefined()
    expect(await exists(path.join(install.userData, LOCAL_STORAGE_EXPORT_FILE))).toBe(false)
  })

  it('is idempotent: a second launch hands over the same import and rewrites nothing', async () => {
    const install = await electronInstall()
    const options = migrationOptions(install)
    const first = await runElectronMigration(options)
    const vaultBefore = await readFile(path.join(install.userData, 'mcp', 'vault.json'), 'utf8')
    const second = await runElectronMigration(options)
    expect(second.localStorageImport?.importId).toBe(first.localStorageImport?.importId)
    expect(await readFile(path.join(install.userData, 'mcp', 'vault.json'), 'utf8')).toBe(
      vaultBefore,
    )
    await acknowledgeLocalStorageImport(options, first.localStorageImport?.importId ?? '')
    const third = await runElectronMigration(options)
    expect(third.localStorageImport).toBeUndefined()
    expect(third.state.completedAt).toBeDefined()
  })

  it('ignores an acknowledgement for another import', async () => {
    const install = await electronInstall()
    const options = migrationOptions(install)
    await runElectronMigration(options)
    const state = await acknowledgeLocalStorageImport(options, 'stale-import')
    expect(state?.steps['local-storage'].status).toBe('awaiting-renderer')
  })

  it('runs only the selected steps, so the keychain step can wait for consent', async () => {
    const install = await electronInstall()
    const vaultBefore = await readFile(path.join(install.userData, 'mcp', 'vault.json'), 'utf8')
    const withoutSecrets = await runElectronMigration({
      ...migrationOptions(install),
      steps: ['local-storage', 'browser-preview-reset'],
    })
    expect(withoutSecrets.state.steps.secrets.status).toBe('pending')
    expect(withoutSecrets.state.steps['local-storage'].status).toBe('awaiting-renderer')
    expect(await readFile(path.join(install.userData, 'mcp', 'vault.json'), 'utf8')).toBe(
      vaultBefore,
    )

    const secretsOnly = await runElectronMigration({
      ...migrationOptions(install),
      steps: ['secrets'],
    })
    expect(secretsOnly.state.steps.secrets.status).toBe('done')
  })

  it('blocks the secrets step without touching files when the old key is unavailable, then resumes', async () => {
    const install = await electronInstall()
    const secrets = memorySecrets()
    const vaultBefore = await readFile(path.join(install.userData, 'mcp', 'vault.json'), 'utf8')
    const refused = migrationOptions(
      install,
      async () => {
        throw new Error('User interaction is not allowed.')
      },
      secrets,
    )
    const blocked = await runElectronMigration(refused)
    expect(blocked.state.steps.secrets.status).toBe('blocked')
    expect(blocked.state.steps['browser-preview-reset'].status).toBe('done')
    expect(await readFile(path.join(install.userData, 'mcp', 'vault.json'), 'utf8')).toBe(
      vaultBefore,
    )

    const resumed = await runElectronMigration(migrationOptions(install, undefined, secrets))
    expect(resumed.state.steps.secrets.status).toBe('done')
    expect(resumed.state.steps.secrets.attempts).toBe(2)
  })

  it('resumes after a failure part way through without sealing a blob twice', async () => {
    const install = await electronInstall()
    const secrets = memorySecrets()
    const working = migrationOptions(install, undefined, secrets)
    let seals = 0
    const failing = {
      ...working,
      codec: {
        ...working.codec,
        seal: async (plaintext: string) => {
          seals += 1
          // Fails on the OAuth store, after the vault was rewritten.
          if (seals === 2) throw new Error('disk full')
          return working.codec.seal(plaintext)
        },
      },
    }
    const failed = await runElectronMigration(failing)
    expect(failed.state.steps.secrets.status).toBe('failed')
    expect(failed.state.steps.secrets.error).toBe('disk full')
    const resumed = await runElectronMigration(working)
    expect(resumed.state.steps.secrets.status).toBe('done')
    const blobs = await vaultBlobs(install.userData)
    await expect(working.sealer.open(blobs['GITHUB_TOKEN'] ?? Buffer.alloc(0))).resolves.toBe(
      'ghp_example',
    )
  })

  it('takes over the shared pre-ADR-0032 vault when the install has none of its own', async () => {
    const install = await electronInstall()
    await rm(path.join(install.userData, 'mcp', 'vault.json'))
    const shared = {
      version: 1,
      secrets: {
        SHARED: {
          encryptedValue: macBlob('shared value').toString('base64'),
          createdAt: 1,
          updatedAt: 1,
        },
        OTHER_BUILD: {
          encryptedValue: macBlob('x', 'dev key').toString('base64'),
          createdAt: 1,
          updatedAt: 1,
        },
      },
    }
    const sharedVault = path.join(install.sharedMcpDirectory, 'vault.json')
    await writeFile(sharedVault, JSON.stringify(shared))
    const options = migrationOptions(install)
    await runElectronMigration(options)
    const blobs = await vaultBlobs(install.userData)
    expect(Object.keys(blobs)).toEqual(['SHARED'])
    await expect(options.sealer.open(blobs['SHARED'] ?? Buffer.alloc(0))).resolves.toBe(
      'shared value',
    )
    expect(await readFile(sharedVault, 'utf8')).toBe(JSON.stringify(shared))
  })

  it('records a fresh install as complete without touching anything', async () => {
    const root = await temporaryTestDirectory('ow-fresh-install-')
    const options = migrationOptions({
      userData: path.join(root, 'openwaggle'),
      sharedMcpDirectory: path.join(root, 'mcp'),
    })
    const report = await runElectronMigration(options)
    expect(report.state.fromElectron).toBe(false)
    expect(report.state.completedAt).toBeDefined()
    expect((await readMigrationState(options.userData))?.completedAt).toBe(report.state.completedAt)
  })
})
