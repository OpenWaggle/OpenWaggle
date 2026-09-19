import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

describe('duplicate protected credential recovery', () => {
  let root = ''

  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true })
  })

  it('recovers one credential from retained source and copy after a rejected request', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pending-duplicate-'))
    const destination = { kind: 'credential-store' as const, stateRoot: root }
    const credential = generateProfileCredential()
    const original = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential,
      stagingKey: 'unknown-create',
      replace: false,
    })
    const rejected = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      stagingKey: 'rejected-create',
      recoverAnyPending: true,
      replace: false,
    })
    expect(rejected.credential).toBe(credential)
    expect(rejected.recoveryLocation).not.toBe(original.recoveryLocation)
    // The Host rejects the copied request; both protected files must remain recoverable.
    const originalBytes = await fs.readFile(original.recoveryLocation)
    const rejectedBytes = await fs.readFile(rejected.recoveryLocation)

    const rotation = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      stagingKey: 'recovery-rotation',
      recoverAnyPending: true,
      replace: true,
    })

    expect(rotation.credential).toBe(credential)
    expect(rotation.recoveredPending).toBe(true)
    await expect(fs.readFile(original.recoveryLocation)).resolves.toEqual(originalBytes)
    await expect(fs.readFile(rejected.recoveryLocation)).resolves.toEqual(rejectedBytes)
    await rotation.commit()
    await expect(
      readStoredProfileCredential({ stateRoot: root, profileName: 'reviewer' }),
    ).resolves.toBe(credential)
  })
})
