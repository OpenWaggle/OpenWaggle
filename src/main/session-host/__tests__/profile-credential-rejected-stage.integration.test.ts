import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ safeStorage: {} }))

import { generateProfileCredential } from '../profile-credential'
import { stageProfileCredential } from '../profile-credential-destination'
import { validateStagedCredentialDestination } from '../profile-credential-preflight'

describe('profile credential rejected preparation', () => {
  let root = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-rejected-credential-stage-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('leaves no fresh pending bearer when an existing different destination rejects preparation', async () => {
    const destination = path.join(root, 'worker.secret')
    const installedCredential = generateProfileCredential()
    await fs.writeFile(destination, `${installedCredential}\n`, { mode: 0o600 })

    await expect(
      stageProfileCredential({
        destination: { kind: 'file', path: destination },
        stateRoot: root,
        profileName: 'worker',
        credential: generateProfileCredential(),
        replace: false,
      }),
    ).rejects.toThrow('Credential destination already exists')

    expect(await fs.readFile(destination, 'utf8')).toBe(`${installedCredential}\n`)
    expect(await fs.readdir(path.join(root, 'profile-credential-staging'))).toEqual([])
  })

  it('preserves recovered pending data and reports its path when a later destination check fails', async () => {
    const destination = { kind: 'file' as const, path: path.join(root, 'worker.secret') }
    const first = await stageProfileCredential({
      destination,
      stateRoot: root,
      profileName: 'worker',
      credential: generateProfileCredential(),
      stagingKey: 'earlier-operation',
      replace: false,
    })
    const pendingContent = await fs.readFile(first.recoveryLocation)
    await fs.writeFile(destination.path, `${generateProfileCredential()}\n`, { mode: 0o600 })

    const retry = stageProfileCredential({
      destination,
      stateRoot: root,
      profileName: 'worker',
      credential: generateProfileCredential(),
      stagingKey: 'earlier-operation',
      replace: false,
    })

    await expect(retry).rejects.toMatchObject({
      recoveryLocation: first.recoveryLocation,
      cause: expect.objectContaining({ message: expect.stringContaining('already exists') }),
    })
    await expect(retry).rejects.not.toThrow(first.credential)
    expect(await fs.readFile(first.recoveryLocation)).toEqual(pendingContent)
  })

  it('preserves a fresh pending bearer and reports its path after a late destination rejection', async () => {
    const destination = { kind: 'file' as const, path: path.join(root, 'worker.secret') }
    const credential = generateProfileCredential()
    const installedCredential = generateProfileCredential()
    const staging = stageProfileCredential({
      destination,
      stateRoot: root,
      profileName: 'worker',
      credential,
      replace: false,
      beforeStagingWrite: () =>
        fs.writeFile(destination.path, `${installedCredential}\n`, { mode: 0o600 }),
    })

    await expect(staging).rejects.toMatchObject({
      name: 'ProfileCredentialPreparationError',
      recoveryLocation: expect.stringContaining('profile-credential-staging'),
    })
    await expect(staging).rejects.not.toThrow(credential)
    const stagingDirectory = path.join(root, 'profile-credential-staging')
    const pending = await fs.readdir(stagingDirectory)
    expect(pending).toHaveLength(1)
    expect(await fs.readFile(path.join(stagingDirectory, pending[0] ?? ''), 'utf8')).toBe(
      `${credential}\n`,
    )
    expect(await fs.readFile(destination.path, 'utf8')).toBe(`${installedCredential}\n`)
  })

  it('keeps shared pending recovery available when its creator fails after another caller adopts it', async () => {
    const destination = { kind: 'file' as const, path: path.join(root, 'worker.secret') }
    const staged = await stageProfileCredential({
      destination,
      stateRoot: root,
      profileName: 'worker',
      credential: generateProfileCredential(),
      replace: false,
    })
    const stagingDirectory = path.dirname(staged.recoveryLocation)
    const temporaryName = path.basename(staged.recoveryLocation)
    await fs.writeFile(destination.path, `${generateProfileCredential()}\n`, { mode: 0o600 })
    const adopted = await stageProfileCredential({
      destination,
      stateRoot: root,
      profileName: 'worker',
      credential: generateProfileCredential(),
      recoverAnyPending: true,
      replace: true,
    })

    const preparation = validateStagedCredentialDestination({
      destination,
      targetPath: destination.path,
      selectedCredential: staged.credential,
      replace: false,
      stagingDirectory,
      temporaryName,
    })

    await expect(preparation).rejects.toMatchObject({
      name: 'ProfileCredentialPreparationError',
      recoveryLocation: staged.recoveryLocation,
      cause: expect.objectContaining({ message: expect.stringContaining('already exists') }),
    })
    await expect(preparation).rejects.not.toThrow(staged.credential)
    expect(adopted.recoveredPending).toBe(true)
    expect(adopted.recoveryLocation).not.toBe(staged.recoveryLocation)
    expect(await fs.readFile(staged.recoveryLocation, 'utf8')).toBe(`${staged.credential}\n`)
    await staged.discard()
    expect(await fs.readFile(adopted.recoveryLocation, 'utf8')).toBe(`${staged.credential}\n`)
    await adopted.commit()
    expect(await fs.readFile(destination.path, 'utf8')).toBe(`${staged.credential}\n`)
  })

  it('still recovers a matching destination installed before receipt persistence', async () => {
    const destination = { kind: 'file' as const, path: path.join(root, 'worker.secret') }
    const credential = generateProfileCredential()
    const first = await stageProfileCredential({
      destination,
      stateRoot: root,
      profileName: 'worker',
      credential,
      stagingKey: 'installed-without-receipt',
      replace: false,
    })
    await fs.writeFile(destination.path, `${credential}\n`, { mode: 0o600 })

    const retry = await stageProfileCredential({
      destination,
      stateRoot: root,
      profileName: 'worker',
      credential: generateProfileCredential(),
      stagingKey: 'installed-without-receipt',
      replace: false,
    })
    expect(retry.recoveredPending).toBe(true)
    expect(retry.credential).toBe(first.credential)
    await retry.commit()
    expect(await fs.readFile(destination.path, 'utf8')).toBe(`${credential}\n`)
    expect(await fs.readdir(path.dirname(first.recoveryLocation))).toEqual([])
  })
})
