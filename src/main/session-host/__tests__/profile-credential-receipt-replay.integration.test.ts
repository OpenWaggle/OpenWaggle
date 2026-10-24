import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
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
import { stageProfileCredential } from '../profile-credential-destination'
import { receiptPath } from '../profile-credential-destination-support'

const PROFILE = 'reviewer'
const STAGING_KEY = 'replayed-request'
const DIRECTORY_CHANGED = 'The credential destination directory changed after installation.'

/** A device number that differs from the live one, as after a macOS reboot renumbers volumes. */
function otherDevice(device: bigint) {
  return (device + 3n).toString()
}

describe('profile credential receipt replay', () => {
  let root = ''
  let installedReceipt = ''
  let credentialDirectory = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-profile-receipt-'))
    installedReceipt = receiptPath(
      root,
      PROFILE,
      createHash('sha256').update(STAGING_KEY).digest('hex'),
    )
    credentialDirectory = path.join(root, 'profile-credentials')
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  async function installCredential() {
    const credential = generateProfileCredential()
    const staged = await stageProfileCredential({
      destination: { kind: 'credential-store', stateRoot: root },
      profileName: PROFILE,
      credential,
      replace: false,
      stagingKey: STAGING_KEY,
    })
    await staged.commit()
    return credential
  }

  function replay() {
    return stageProfileCredential({
      destination: { kind: 'credential-store', stateRoot: root },
      profileName: PROFILE,
      credential: generateProfileCredential(),
      replace: false,
      stagingKey: STAGING_KEY,
    })
  }

  /** Rewrites the persisted receipt with a chosen directory record, keeping its fingerprint. */
  async function rewriteReceipt(directory: Record<string, unknown>) {
    const written: unknown = JSON.parse(await fs.readFile(installedReceipt, 'utf8'))
    if (
      typeof written !== 'object' ||
      written === null ||
      !('targetPath' in written) ||
      !('fingerprint' in written)
    ) {
      throw new Error('Expected an installed credential receipt.')
    }
    await fs.writeFile(
      installedReceipt,
      JSON.stringify({
        targetPath: written.targetPath,
        fingerprint: written.fingerprint,
        ...directory,
      }),
    )
  }

  async function liveDirectory() {
    return fs.stat(credentialDirectory, { bigint: true })
  }

  it('persists the durable directory identity of the destination', async () => {
    await installCredential()
    const stats = await liveDirectory()

    const written: unknown = JSON.parse(await fs.readFile(installedReceipt, 'utf8'))
    expect(written).toMatchObject({
      directory: {
        device: stats.dev.toString(),
        inode: stats.ino.toString(),
        birthtime: stats.birthtimeNs.toString(),
      },
    })
  })

  it('replays a receipt whose stored device number differs from the live one', async () => {
    const credential = await installCredential()
    const stats = await liveDirectory()
    await rewriteReceipt({
      directory: {
        device: otherDevice(stats.dev),
        inode: stats.ino.toString(),
        birthtime: stats.birthtimeNs.toString(),
      },
    })

    const retry = await replay()

    expect(retry.credential).toBe(credential)
    expect(retry.recoveredPending).toBe(false)
    await expect(retry.commit()).resolves.toBeUndefined()
  })

  it('replays a legacy `dev:ino` receipt whose stored device number differs', async () => {
    const credential = await installCredential()
    const stats = await liveDirectory()
    await rewriteReceipt({ directoryIdentity: `${otherDevice(stats.dev)}:${stats.ino}` })

    const retry = await replay()

    expect(retry.credential).toBe(credential)
    await expect(retry.commit()).resolves.toBeUndefined()
  })

  it('refuses a receipt whose directory has the same inode but a different birth time', async () => {
    await installCredential()
    const stats = await liveDirectory()
    await rewriteReceipt({
      directory: {
        device: stats.dev.toString(),
        inode: stats.ino.toString(),
        birthtime: (stats.birthtimeNs + 1n).toString(),
      },
    })

    await expect(replay()).rejects.toThrow(DIRECTORY_CHANGED)
  })

  it.each([
    ['a durable', false],
    ['a legacy', true],
  ])('refuses %s receipt after the destination directory was replaced', async (_kind, legacy) => {
    await installCredential()
    const stats = await liveDirectory()
    if (legacy) await rewriteReceipt({ directoryIdentity: `${stats.dev}:${stats.ino}` })
    const credentialFile = (await fs.readdir(credentialDirectory))[0]
    if (!credentialFile) throw new Error('Expected an installed credential file.')
    // Keep the original folder so its inode cannot be reused by the replacement.
    const original = path.join(root, 'profile-credentials-original')
    await fs.rename(credentialDirectory, original)
    await fs.mkdir(credentialDirectory, { mode: 0o700 })
    await fs.copyFile(
      path.join(original, credentialFile),
      path.join(credentialDirectory, credentialFile),
    )
    await fs.chmod(path.join(credentialDirectory, credentialFile), 0o600)

    await expect(replay()).rejects.toThrow(DIRECTORY_CHANGED)
  })
})
