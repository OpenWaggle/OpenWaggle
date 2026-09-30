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
import {
  readStoredProfileCredential,
  stageProfileCredential,
} from '../profile-credential-destination'

describe('profile credential consumed-marker race', () => {
  let root = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pending-consumed-race-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('marks a copy made during another installation so later rotations cannot re-adopt it', async () => {
    const destination = { kind: 'credential-store' as const, stateRoot: root }
    const installedCredential = generateProfileCredential()
    const installing = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: installedCredential,
      stagingKey: 'first-operation',
      replace: false,
    })

    const racingCopy = stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      stagingKey: 'second-operation',
      recoverAnyPending: true,
      replace: true,
      beforeStagingWrite: () => installing.commit(),
    })
    await expect(racingCopy).rejects.toMatchObject({
      name: 'ProfileCredentialPendingRecoveryError',
      recoveryLocation: installing.recoveryLocation,
    })
    await expect(
      readStoredProfileCredential({ stateRoot: root, profileName: 'reviewer' }),
    ).resolves.toBe(installedCredential)

    const nextCredential = generateProfileCredential()
    const next = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: nextCredential,
      stagingKey: 'third-operation',
      recoverAnyPending: true,
      replace: true,
    })
    expect(next.credential).toBe(nextCredential)
    await next.commit()

    const laterCredential = generateProfileCredential()
    const later = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: laterCredential,
      stagingKey: 'fourth-operation',
      recoverAnyPending: true,
      replace: true,
    })
    expect(later.credential).toBe(laterCredential)
    await later.discard()
  })

  it('does not dispatch bytes from a source replaced during the copy', async () => {
    const destination = { kind: 'credential-store' as const, stateRoot: root }
    const original = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      stagingKey: 'first-operation',
      replace: false,
    })
    const replacementCredential = generateProfileCredential()
    const racingCopy = stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      stagingKey: 'second-operation',
      recoverAnyPending: true,
      replace: false,
      beforeStagingWrite: async () => {
        await original.discard()
        await stageProfileCredential({
          destination,
          profileName: 'reviewer',
          credential: replacementCredential,
          stagingKey: 'first-operation',
          replace: false,
        })
      },
    })
    await expect(racingCopy).rejects.toMatchObject({
      name: 'ProfileCredentialPendingRecoveryError',
      recoveryLocation: original.recoveryLocation,
    })

    const next = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      stagingKey: 'third-operation',
      recoverAnyPending: true,
      replace: false,
    })
    expect(next.credential).toBe(replacementCredential)
    await next.discard()
  })
})
