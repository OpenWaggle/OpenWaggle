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

describe('profile credential pending adoption', () => {
  let root = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pending-adoption-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('keeps an adopted credential recoverable after the original request discards its pending file', async () => {
    const destination = { kind: 'credential-store' as const, stateRoot: root }
    const credential = generateProfileCredential()
    const original = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential,
      stagingKey: 'rejected-create',
      replace: false,
    })
    const adopted = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      stagingKey: 'accepted-rotation',
      recoverAnyPending: true,
      replace: true,
    })

    expect(adopted.credential).toBe(credential)
    expect(adopted.recoveryLocation).not.toBe(original.recoveryLocation)
    expect((await fs.stat(adopted.recoveryLocation)).mode & 0o777).toBe(0o600)
    await original.discard()
    await expect(fs.readFile(original.recoveryLocation)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.readFile(adopted.recoveryLocation)).resolves.toBeDefined()

    const retry = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      stagingKey: 'accepted-rotation',
      recoverAnyPending: true,
      replace: true,
    })
    expect(retry.credential).toBe(credential)
    expect(retry.recoveryLocation).toBe(adopted.recoveryLocation)
    await retry.commit()
    await expect(
      readStoredProfileCredential({ stateRoot: root, profileName: 'reviewer' }),
    ).resolves.toBe(credential)
  })

  it('prefers its own pending copy when the original artifact still exists', async () => {
    const destination = { kind: 'credential-store' as const, stateRoot: root }
    const original = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      stagingKey: 'first-operation',
      replace: false,
    })
    const adopted = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      stagingKey: 'second-operation',
      recoverAnyPending: true,
      replace: false,
    })
    const retry = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      stagingKey: 'second-operation',
      recoverAnyPending: true,
      replace: false,
    })

    expect(retry.credential).toBe(original.credential)
    expect(retry.recoveryLocation).toBe(adopted.recoveryLocation)
    await expect(fs.readFile(original.recoveryLocation)).resolves.toBeDefined()
    await retry.discard()
    await original.discard()
  })

  it('does not re-adopt an installed secret on later fresh rotations while retaining exact-key recovery', async () => {
    const destination = { kind: 'credential-store' as const, stateRoot: root }
    const originalCredential = generateProfileCredential()
    const original = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: originalCredential,
      stagingKey: 'first-operation',
      replace: false,
    })
    const originalBytes = await fs.readFile(original.recoveryLocation)
    const adopted = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      stagingKey: 'second-operation',
      recoverAnyPending: true,
      replace: true,
    })
    expect(adopted.credential).toBe(originalCredential)
    await adopted.commit()
    await expect(fs.readFile(original.recoveryLocation)).resolves.toEqual(originalBytes)
    const markerDirectory = path.dirname(original.recoveryLocation)
    const markers = (await fs.readdir(markerDirectory)).filter((name) => name.endsWith('.consumed'))
    expect(markers).not.toHaveLength(0)
    for (const marker of markers) {
      const markerPath = path.join(markerDirectory, marker)
      expect((await fs.stat(markerPath)).mode & 0o777).toBe(0o600)
      expect((await fs.readFile(markerPath, 'utf8')).includes(originalCredential)).toBe(false)
    }

    const exactRetry = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      stagingKey: 'first-operation',
      recoverAnyPending: true,
      replace: true,
    })
    expect(exactRetry.credential).toBe(originalCredential)
    expect(exactRetry.recoveryLocation).toBe(original.recoveryLocation)

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
    expect(next.recoveredPending).toBe(false)
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
    expect(later.recoveredPending).toBe(false)
    await later.commit()
    await expect(
      readStoredProfileCredential({ stateRoot: root, profileName: 'reviewer' }),
    ).resolves.toBe(laterCredential)
    await expect(fs.readFile(original.recoveryLocation)).resolves.toEqual(originalBytes)

    const originalAfterRotations = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      stagingKey: 'first-operation',
      recoverAnyPending: true,
      replace: true,
    })
    expect(originalAfterRotations.credential).toBe(originalCredential)
    expect(originalAfterRotations.recoveryLocation).toBe(original.recoveryLocation)
  })

  it('records an already-installed pending source before a later rotation replaces the store', async () => {
    const destination = { kind: 'credential-store' as const, stateRoot: root }
    const originalCredential = generateProfileCredential()
    const original = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: originalCredential,
      stagingKey: 'first-operation',
      replace: false,
    })
    const adopted = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      stagingKey: 'second-operation',
      recoverAnyPending: true,
      replace: true,
    })
    await adopted.commit()
    const directory = path.dirname(original.recoveryLocation)
    const markers = (await fs.readdir(directory)).filter((name) => name.endsWith('.consumed'))
    expect(markers).not.toHaveLength(0)
    for (const marker of markers) await fs.unlink(path.join(directory, marker))

    const freshCredential = generateProfileCredential()
    const fresh = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: freshCredential,
      stagingKey: 'third-operation',
      recoverAnyPending: true,
      replace: true,
    })
    expect(fresh.credential).toBe(freshCredential)
    expect((await fs.readdir(directory)).some((name) => name.endsWith('.consumed'))).toBe(true)
    await fresh.commit()

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

  it('binds a consumed marker to the original file identity, not a reused operation name', async () => {
    const destination = { kind: 'credential-store' as const, stateRoot: root }
    const original = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      stagingKey: 'first-operation',
      replace: false,
    })
    const adopted = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      stagingKey: 'second-operation',
      recoverAnyPending: true,
      replace: true,
    })
    await adopted.commit()
    await original.discard()

    const replacementCredential = generateProfileCredential()
    const replacement = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: replacementCredential,
      stagingKey: 'first-operation',
      replace: true,
    })
    expect(replacement.recoveryLocation).toBe(original.recoveryLocation)
    const recovered = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      stagingKey: 'third-operation',
      recoverAnyPending: true,
      replace: true,
    })
    expect(recovered.credential).toBe(replacementCredential)
    await recovered.discard()
    await replacement.discard()
  })

  it('reports the source path if making the adopting operation copy fails', async () => {
    const destination = { kind: 'credential-store' as const, stateRoot: root }
    const original = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      stagingKey: 'first-operation',
      replace: false,
    })
    const originalBytes = await fs.readFile(original.recoveryLocation)
    const attempt = stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      stagingKey: 'second-operation',
      recoverAnyPending: true,
      replace: false,
      beforeStagingWrite: async () => {
        throw new Error('copy stopped')
      },
    })

    await expect(attempt).rejects.toMatchObject({
      name: 'ProfileCredentialPendingRecoveryError',
      recoveryLocation: original.recoveryLocation,
    })
    await expect(fs.readFile(original.recoveryLocation)).resolves.toEqual(originalBytes)
    expect(await fs.readdir(path.dirname(original.recoveryLocation))).toEqual([
      path.basename(original.recoveryLocation),
    ])
  })
})
