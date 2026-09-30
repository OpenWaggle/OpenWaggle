import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { safeStorage } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, 'utf8').map((byte) => byte ^ 0xa5),
    decryptString: (value: Buffer) =>
      Buffer.from(value.map((byte) => byte ^ 0xa5)).toString('utf8'),
  },
}))

import { generateProfileCredential } from '../profile-credential'
import {
  readStoredProfileCredential,
  stageProfileCredential,
} from '../profile-credential-destination'

function legacyPendingPath(root: string, key: string) {
  const profile = createHash('sha256').update('reviewer').digest('hex')
  const operation = createHash('sha256').update(key).digest('hex')
  return path.join(root, 'profile-credential-staging', `${profile}.${operation}.pending`)
}

describe('profile credential pending destination scope', () => {
  let root = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pending-scope-'))
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(root, { recursive: true, force: true })
  })

  it('can prepare a GUI store credential without adopting or altering a pending CLI file credential', async () => {
    const fileCredential = generateProfileCredential()
    const file = await stageProfileCredential({
      destination: { kind: 'file', path: path.join(root, 'cli.secret') },
      stateRoot: root,
      profileName: 'reviewer',
      credential: fileCredential,
      stagingKey: 'cli-create',
      replace: false,
    })
    const original = await fs.readFile(file.recoveryLocation)
    const storeCredential = generateProfileCredential()

    const store = await stageProfileCredential({
      destination: { kind: 'credential-store', stateRoot: root },
      profileName: 'reviewer',
      credential: storeCredential,
      stagingKey: 'gui-create',
      recoverAnyPending: true,
      replace: false,
    })

    expect(store.credential).toBe(storeCredential)
    expect(store.recoveredPending).toBe(false)
    expect(store.recoveryLocation).not.toBe(file.recoveryLocation)
    await store.commit()
    await expect(
      readStoredProfileCredential({ stateRoot: root, profileName: 'reviewer' }),
    ).resolves.toBe(storeCredential)
    await expect(fs.readFile(file.recoveryLocation)).resolves.toEqual(original)
    await file.discard()
  })

  it('recovers a legacy credential-store pending file for an exact-key retry', async () => {
    const destination = { kind: 'credential-store' as const, stateRoot: root }
    const key = 'legacy-request'
    const credential = generateProfileCredential()
    const staged = await stageProfileCredential({
      destination,
      stateRoot: root,
      profileName: 'reviewer',
      credential,
      stagingKey: key,
      replace: false,
    })
    const legacyPath = legacyPendingPath(root, key)
    await fs.rename(staged.recoveryLocation, legacyPath)
    const original = await fs.readFile(legacyPath)

    const retry = await stageProfileCredential({
      destination,
      stateRoot: root,
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      stagingKey: key,
      replace: false,
    })

    expect(retry.recoveredPending).toBe(true)
    expect(retry.credential).toBe(credential)
    expect(retry.recoveryLocation).toBe(legacyPath)
    await expect(fs.readFile(legacyPath)).resolves.toEqual(original)
    await retry.discard()
  })

  it('recovers a legacy store artifact without treating unrelated legacy plaintext as store content', async () => {
    const file = await stageProfileCredential({
      destination: { kind: 'file', path: path.join(root, 'cli.secret') },
      stateRoot: root,
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      stagingKey: 'old-cli',
      replace: false,
    })
    const filePath = legacyPendingPath(root, 'old-cli')
    await fs.rename(file.recoveryLocation, filePath)
    const fileBytes = await fs.readFile(filePath)
    const credential = generateProfileCredential()
    const store = await stageProfileCredential({
      destination: { kind: 'credential-store', stateRoot: root },
      profileName: 'reviewer',
      credential,
      stagingKey: 'old-gui',
      replace: false,
    })
    const storePath = legacyPendingPath(root, 'old-gui')
    await fs.rename(store.recoveryLocation, storePath)
    const storeBytes = await fs.readFile(storePath)

    const recovered = await stageProfileCredential({
      destination: { kind: 'credential-store', stateRoot: root },
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      stagingKey: 'new-gui',
      recoverAnyPending: true,
      replace: false,
    })

    expect(recovered.credential).toBe(credential)
    expect(recovered.recoveredPending).toBe(true)
    expect(recovered.recoveryLocation).not.toBe(storePath)
    await expect(fs.readFile(filePath)).resolves.toEqual(fileBytes)
    await expect(fs.readFile(storePath)).resolves.toEqual(storeBytes)
    await expect(fs.readFile(recovered.recoveryLocation)).resolves.toEqual(storeBytes)
    await recovered.discard()
  })

  it('reports an unprovable legacy file destination without changing its protected bytes', async () => {
    const credential = generateProfileCredential()
    const file = await stageProfileCredential({
      destination: { kind: 'file', path: path.join(root, 'old.secret') },
      stateRoot: root,
      profileName: 'reviewer',
      credential,
      stagingKey: 'old-file',
      replace: false,
    })
    const legacyPath = legacyPendingPath(root, 'old-file')
    await fs.rename(file.recoveryLocation, legacyPath)
    const original = await fs.readFile(legacyPath)

    const result = stageProfileCredential({
      destination: { kind: 'file', path: path.join(root, 'new.secret') },
      stateRoot: root,
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      stagingKey: 'new-file',
      recoverAnyPending: true,
      replace: false,
    })

    await expect(result).rejects.toThrow(legacyPath)
    await expect(fs.readFile(legacyPath)).resolves.toEqual(original)
    expect(await fs.readdir(path.dirname(legacyPath))).toEqual([path.basename(legacyPath)])
  })

  it.each(['file', 'credential-store'] as const)(
    'does not recover a new %s artifact into a different file target',
    async (kind) => {
      const destination =
        kind === 'file'
          ? { kind, path: path.join(root, 'first.secret') }
          : { kind, stateRoot: root }
      const first = await stageProfileCredential({
        destination,
        stateRoot: root,
        profileName: 'reviewer',
        credential: generateProfileCredential(),
        stagingKey: 'same-key',
        replace: false,
      })
      const original = await fs.readFile(first.recoveryLocation)
      const credential = generateProfileCredential()
      const second = await stageProfileCredential({
        destination: { kind: 'file', path: path.join(root, 'second.secret') },
        stateRoot: root,
        profileName: 'reviewer',
        credential,
        stagingKey: 'same-key',
        recoverAnyPending: true,
        replace: false,
      })

      expect(second.credential).toBe(credential)
      expect(second.recoveredPending).toBe(false)
      expect(second.recoveryLocation).not.toBe(first.recoveryLocation)
      await expect(fs.readFile(first.recoveryLocation)).resolves.toEqual(original)
      await second.discard()
      await first.discard()
    },
  )

  it('never submits legacy plaintext to the store decryptor while preparing a fresh GUI credential', async () => {
    const file = await stageProfileCredential({
      destination: { kind: 'file', path: path.join(root, 'cli.secret') },
      stateRoot: root,
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      stagingKey: 'old-cli',
      replace: false,
    })
    const legacyPath = legacyPendingPath(root, 'old-cli')
    await fs.rename(file.recoveryLocation, legacyPath)
    const original = await fs.readFile(legacyPath)
    const decrypt = vi.spyOn(safeStorage, 'decryptString')
    const credential = generateProfileCredential()
    const store = await stageProfileCredential({
      destination: { kind: 'credential-store', stateRoot: root },
      profileName: 'reviewer',
      credential,
      stagingKey: 'gui-new',
      recoverAnyPending: true,
      replace: false,
    })

    expect(store.credential).toBe(credential)
    expect(store.recoveredPending).toBe(false)
    expect(decrypt).toHaveBeenCalledOnce()
    expect(decrypt).not.toHaveBeenCalledWith(original)
    await expect(fs.readFile(legacyPath)).resolves.toEqual(original)
    await store.discard()
  })

  it('reports the actual path for unreadable legacy recovery material without replacing it', async () => {
    const legacyPath = legacyPendingPath(root, 'unknown-old-request')
    const original = Buffer.from('unreadable legacy encrypted material')
    await fs.mkdir(path.dirname(legacyPath))
    await fs.writeFile(legacyPath, original, { mode: 0o600 })

    const attempt = stageProfileCredential({
      destination: { kind: 'credential-store', stateRoot: root },
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      stagingKey: 'gui-new',
      recoverAnyPending: true,
      replace: false,
    })

    await expect(attempt).rejects.toThrow(legacyPath)
    await expect(fs.readFile(legacyPath)).resolves.toEqual(original)
    expect(await fs.readdir(path.dirname(legacyPath))).toEqual([path.basename(legacyPath)])
  })

  it('requires manual review when both legacy and scoped store artifacts are compatible', async () => {
    const destination = { kind: 'credential-store' as const, stateRoot: root }
    const legacy = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      stagingKey: 'old-request',
      replace: false,
    })
    const legacyPath = legacyPendingPath(root, 'old-request')
    await fs.rename(legacy.recoveryLocation, legacyPath)
    const scoped = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      stagingKey: 'scoped-request',
      replace: false,
    })
    const legacyBytes = await fs.readFile(legacyPath)
    const scopedBytes = await fs.readFile(scoped.recoveryLocation)

    const attempt = stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      stagingKey: 'gui-new',
      recoverAnyPending: true,
      replace: false,
    })

    await expect(attempt).rejects.toThrow('Multiple protected credential recovery artifacts')
    await expect(fs.readFile(legacyPath)).resolves.toEqual(legacyBytes)
    await expect(fs.readFile(scoped.recoveryLocation)).resolves.toEqual(scopedBytes)
    expect(await fs.readdir(path.dirname(legacyPath))).toHaveLength(2)
  })
})
