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

describe('profile credential storage boundaries', () => {
  let root = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-credential-security-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('does not write through a staging directory swapped after validation', async () => {
    const staging = path.join(root, 'profile-credential-staging')
    const moved = path.join(root, 'staging-authorized')
    const outside = path.join(root, 'outside-staging')
    await fs.mkdir(outside)

    await expect(
      stageProfileCredential({
        destination: { kind: 'file', path: path.join(root, 'credentials/worker.secret') },
        stateRoot: root,
        profileName: 'worker',
        credential: generateProfileCredential(),
        replace: false,
        beforeStagingWrite: async () => {
          await fs.rename(staging, moved)
          await fs.symlink(outside, staging)
        },
      }),
    ).rejects.toThrow()
    await expect(fs.readdir(outside)).resolves.toEqual([])
    expect((await fs.readdir(moved)).length).toBe(1)
  })

  it('keeps receipt creation pinned across an ancestor swap', async () => {
    const receiptDirectory = path.join(root, 'profile-credential-receipts')
    const moved = path.join(root, 'receipts-authorized')
    const outside = path.join(root, 'outside-receipts')
    await fs.mkdir(outside)
    const staged = await stageProfileCredential({
      destination: { kind: 'credential-store', stateRoot: root },
      profileName: 'worker',
      credential: generateProfileCredential(),
      replace: false,
      stagingKey: 'receipt-swap',
      beforeReceiptMutation: async () => {
        await fs.rename(receiptDirectory, moved)
        await fs.symlink(outside, receiptDirectory)
      },
    })

    await expect(staged.commit()).resolves.toBeUndefined()
    await expect(fs.readdir(outside)).resolves.toEqual([])
    expect((await fs.readdir(moved)).length).toBe(1)
  })

  it('recovers an installed credential when receipt persistence initially fails', async () => {
    const destination = { kind: 'credential-store' as const, stateRoot: root }
    const credential = generateProfileCredential()
    const first = await stageProfileCredential({
      destination,
      profileName: 'worker',
      credential,
      replace: false,
      stagingKey: 'receipt-retry',
      beforeReceiptWrite: async () => {
        throw new Error('injected receipt failure')
      },
    })
    await expect(first.commit()).rejects.toThrow('remains recoverable')

    const retry = await stageProfileCredential({
      destination,
      profileName: 'worker',
      credential: generateProfileCredential(),
      replace: false,
      stagingKey: 'receipt-retry',
    })
    expect(retry.credential).toBe(credential)
    await expect(retry.commit()).resolves.toBeUndefined()
  })
})
