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
  ProfileCredentialCleanupError,
  readProfileCredentialFile,
  readStoredProfileCredential,
  stageProfileCredential,
} from '../profile-credential-destination'

describe('profile credential destination', () => {
  let root = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-profile-destination-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('atomically installs an owner-only explicit credential file', async () => {
    const credential = generateProfileCredential()
    const destination = path.join(root, 'credentials', 'worker.secret')
    const staged = await stageProfileCredential({
      destination: { kind: 'file', path: destination },
      stateRoot: root,
      profileName: 'worker',
      credential,
      replace: false,
      stagingKey: 'request-create-worker',
    })

    await expect(readProfileCredentialFile(destination)).rejects.toThrow()
    await staged.commit()

    await expect(readProfileCredentialFile(destination)).resolves.toBe(credential)
    expect((await fs.stat(destination)).mode & 0o777).toBe(0o600)
  })

  it('never clobbers a destination created after staging without replace intent', async () => {
    const destination = path.join(root, 'credentials', 'worker.secret')
    const staged = await stageProfileCredential({
      destination: { kind: 'file', path: destination },
      stateRoot: root,
      profileName: 'worker',
      credential: generateProfileCredential(),
      replace: false,
    })
    await fs.writeFile(destination, 'user-owned\n', { mode: 0o600 })

    await expect(staged.commit()).rejects.toThrow('remains recoverable')
    await expect(fs.readFile(destination, 'utf8')).resolves.toBe('user-owned\n')
    await staged.discard()
  })

  it('never clobbers a different file that replaces the staged credential destination', async () => {
    const destination = path.join(root, 'credentials', 'worker.secret')
    const originalCredential = generateProfileCredential()
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(destination, `${originalCredential}\n`, { mode: 0o600 })
    const staged = await stageProfileCredential({
      destination: { kind: 'file', path: destination },
      stateRoot: root,
      profileName: 'worker',
      credential: generateProfileCredential(),
      replace: true,
    })
    const intervening = 'user-owned replacement\n'
    await fs.unlink(destination)
    await fs.writeFile(destination, intervening, { mode: 0o600 })

    await expect(staged.commit()).rejects.toThrow('remains recoverable')
    await expect(fs.readFile(destination, 'utf8')).resolves.toBe(intervening)
    await staged.discard()
  })

  it('keeps installation pinned when the credential directory is moved after validation', async () => {
    const directory = path.join(root, 'credentials')
    const movedDirectory = path.join(root, 'credentials-authorized')
    const outsideDirectory = path.join(root, 'outside-credentials')
    const destination = path.join(directory, 'worker.secret')
    const credential = generateProfileCredential()
    await Promise.all([fs.mkdir(directory), fs.mkdir(outsideDirectory)])
    await Promise.all([
      fs.writeFile(destination, `${generateProfileCredential()}\n`, { mode: 0o600 }),
      fs.writeFile(path.join(outsideDirectory, 'worker.secret'), 'outside user data', {
        mode: 0o600,
      }),
    ])
    const staged = await stageProfileCredential({
      destination: { kind: 'file', path: destination },
      stateRoot: root,
      profileName: 'worker',
      credential,
      replace: true,
      beforeCommitMutation: async () => {
        await fs.rename(directory, movedDirectory)
        await fs.symlink(outsideDirectory, directory)
      },
    })

    await expect(staged.commit()).resolves.toBeUndefined()
    await expect(fs.readFile(path.join(outsideDirectory, 'worker.secret'), 'utf8')).resolves.toBe(
      'outside user data',
    )
    await expect(
      readProfileCredentialFile(path.join(movedDirectory, 'worker.secret')),
    ).resolves.toBe(credential)
  })

  it('reuses the protected pending credential for an idempotent retry', async () => {
    const firstCredential = generateProfileCredential()
    const destination = { kind: 'credential-store' as const, stateRoot: root }
    const first = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: firstCredential,
      replace: false,
      stagingKey: 'stable-request',
    })
    const retry = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      replace: false,
      stagingKey: 'stable-request',
    })

    expect(retry.credential).toBe(firstCredential)
    expect(first.recoveredPending).toBe(false)
    expect(retry.recoveredPending).toBe(true)
    expect(retry.recoveryLocation).toBe(first.recoveryLocation)
    expect(path.dirname(first.recoveryLocation)).toBe(path.join(root, 'profile-credential-staging'))
    await first.discard()
    await retry.discard()
  })

  it('surfaces identity-bound discard failure without deleting a replacement or exposing a bearer', async () => {
    const credential = generateProfileCredential()
    const staged = await stageProfileCredential({
      destination: { kind: 'credential-store', stateRoot: root },
      profileName: 'reviewer',
      credential,
      replace: false,
    })
    const directory = path.join(root, 'profile-credential-staging')
    const [pendingName] = await fs.readdir(directory)
    if (pendingName === undefined) throw new Error('Expected a staged credential file.')
    const pendingPath = path.join(directory, pendingName)
    await fs.writeFile(pendingPath, 'replacement user-owned content')

    const failure = await staged.discard().catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ProfileCredentialCleanupError)
    if (!(failure instanceof ProfileCredentialCleanupError))
      throw new Error('Expected cleanup failure.')
    expect(failure.recoveryLocation).toBe(pendingPath)
    expect(failure.message).toContain(pendingPath)
    expect(failure.message).not.toContain(credential)
    expect(failure.cause).toBeInstanceOf(Error)
    await expect(fs.readFile(pendingPath, 'utf8')).resolves.toBe('replacement user-owned content')
  })

  it('marks a credential adopted after a staging-write race as recovered pending content', async () => {
    const destination = { kind: 'credential-store' as const, stateRoot: root }
    const competingCredential = generateProfileCredential()
    let competing: Awaited<ReturnType<typeof stageProfileCredential>> | undefined
    const staged = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      stagingKey: 'competing-staging-request',
      replace: false,
      beforeStagingWrite: async () => {
        competing = await stageProfileCredential({
          destination,
          profileName: 'reviewer',
          credential: competingCredential,
          stagingKey: 'competing-staging-request',
          replace: false,
        })
      },
    })

    expect(competing?.recoveredPending).toBe(false)
    expect(staged.credential).toBe(competingCredential)
    expect(staged.recoveredPending).toBe(true)
    expect(staged.recoveryLocation).toBe(competing?.recoveryLocation)
    await staged.discard()
  })

  it('treats an already-removed pending credential as successfully discarded', async () => {
    const staged = await stageProfileCredential({
      destination: { kind: 'credential-store', stateRoot: root },
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      replace: false,
    })
    const directory = path.join(root, 'profile-credential-staging')

    await expect(staged.discard()).resolves.toBeUndefined()
    await expect(fs.readdir(directory)).resolves.toEqual([])
    await expect(staged.discard()).resolves.toBeUndefined()
  })

  it('reuses the installed credential after an idempotent operation committed', async () => {
    const firstCredential = generateProfileCredential()
    const destination = { kind: 'credential-store' as const, stateRoot: root }
    const first = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: firstCredential,
      replace: false,
      stagingKey: 'committed-request',
    })
    await first.commit()

    const retry = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      replace: false,
      stagingKey: 'committed-request',
    })

    expect(retry.credential).toBe(firstCredential)
    expect(retry.recoveredPending).toBe(false)
    expect(path.dirname(retry.recoveryLocation)).toBe(path.join(root, 'profile-credentials'))
    await expect(retry.commit()).resolves.toBeUndefined()
  })

  it('lets the GUI recover its only protected pending credential with a new request key', async () => {
    const firstCredential = generateProfileCredential()
    const destination = { kind: 'credential-store' as const, stateRoot: root }
    const first = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: firstCredential,
      replace: false,
      stagingKey: 'first-gui-request',
    })
    const retry = await stageProfileCredential({
      destination,
      profileName: 'reviewer',
      credential: generateProfileCredential(),
      replace: false,
      stagingKey: 'replacement-gui-request',
      recoverAnyPending: true,
    })

    expect(retry.credential).toBe(firstCredential)
    expect(retry.recoveredPending).toBe(true)
    expect(retry.recoveryLocation).toBe(first.recoveryLocation)
    await first.discard()
    await retry.discard()
  })

  it('encrypts credential-store contents and decrypts only when loading the named profile', async () => {
    const credential = generateProfileCredential()
    const staged = await stageProfileCredential({
      destination: { kind: 'credential-store', stateRoot: root },
      profileName: 'external-agent',
      credential,
      replace: false,
    })
    await staged.commit()

    const credentialDirectory = path.join(root, 'profile-credentials')
    const [storedName] = await fs.readdir(credentialDirectory)
    const raw = await fs.readFile(path.join(credentialDirectory, storedName ?? ''))
    expect(raw.toString('utf8')).not.toContain(credential)
    await expect(
      readStoredProfileCredential({ stateRoot: root, profileName: 'external-agent' }),
    ).resolves.toBe(credential)
  })
})
