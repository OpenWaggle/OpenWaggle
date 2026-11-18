import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CREDENTIAL_INSTALLER,
  installCredentialInBoundDirectory,
  ProfileCredentialInstallerRecoveryError,
  profileCredentialInstallerFailure,
} from '../profile-credential-bound-installer'

function runFailedInstaller(
  mode: 'create' | 'replace',
  cleanupCode = 'EACCES',
  rollbackFailure: 'none' | 'link' | 'unlink' = 'none',
) {
  let releaseMutation: (() => void) | undefined
  const locked = Object.assign(new Error('pending cleanup failed'), { code: cleanupCode })
  const occupied = Object.assign(new Error('target exists'), { code: 'EEXIST' })
  const missing = Object.assign(new Error('displaced does not exist'), { code: 'ENOENT' })
  let displacedLookupCount = 0
  const filesystem = {
    statSync: vi.fn(() => ({ dev: 1, ino: 2 })),
    readFileSync: vi.fn(() => Buffer.from('secret')),
    writeFileSync: vi.fn(),
    linkSync: vi.fn(() => {
      if (mode === 'create') throw occupied
      if (rollbackFailure === 'link') throw locked
    }),
    unlinkSync: vi.fn((name: string) => {
      if (name === 'pending') throw locked
      if (name === 'displaced' && rollbackFailure === 'unlink') throw locked
    }),
    existsSync: vi.fn((name: string) => {
      if (rollbackFailure !== 'none') return name === 'displaced'
      return mode === 'replace' && name === 'target'
    }),
    renameSync: vi.fn(),
    lstatSync: vi.fn(() => {
      if (mode === 'create') throw missing
      if (rollbackFailure !== 'none' && displacedLookupCount++ === 0) throw occupied
      return { dev: 3, ino: 4, isFile: () => false }
    }),
  }
  let exitCode: number | undefined
  const process = {
    argv: ['node', mode, 'target', 'pending', 'displaced', '1:2', 'wrong', 'wrong'],
    stdout: { write: vi.fn() },
    stderr: { write: vi.fn() },
    stdin: {
      once: vi.fn((_event: string, listener: () => void) => {
        releaseMutation = listener
      }),
      resume: vi.fn(),
    },
    exit: vi.fn(),
    get exitCode() {
      return exitCode
    },
    set exitCode(value: number | undefined) {
      exitCode = value
    },
  }
  runInNewContext(CREDENTIAL_INSTALLER, {
    process,
    require: (name: string) => (name === 'node:fs' ? filesystem : {}),
  })
  if (!releaseMutation) throw new Error('The installer did not wait for validation.')
  releaseMutation()
  return { process, filesystem }
}

describe('profile credential bound installer', () => {
  let root = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-credential-install-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('rejects a destination directory replaced before the helper pins it', async () => {
    const directory = path.join(root, 'credentials')
    const moved = path.join(root, 'credentials-authorized')
    const sourcePath = path.join(root, 'credential.source')
    await Promise.all([fs.mkdir(directory), fs.writeFile(sourcePath, 'secret')])
    const stats = await fs.stat(directory)
    const sourceHandle = await fs.open(sourcePath, 'r')
    try {
      await expect(
        installCredentialInBoundDirectory({
          directory,
          directoryIdentity: `${stats.dev}:${stats.ino}`,
          targetName: 'profile.credential',
          mode: 'create',
          sourceHandle,
          beforeSpawn: async () => {
            await fs.rename(directory, moved)
            await fs.symlink(moved, directory)
          },
        }),
      ).rejects.toThrow()
    } finally {
      await sourceHandle.close()
    }
    await expect(fs.readdir(moved)).resolves.toEqual([])
  })

  it('reports a protected pending file when cleanup fails after installation fails', () => {
    const { process, filesystem } = runFailedInstaller('create')
    expect(process.exitCode).toBe(78)
    expect(filesystem.unlinkSync).toHaveBeenCalledWith('pending')
    expect(process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining('Pending credential cleanup failed'),
    )
    expect(
      profileCredentialInstallerFailure({
        exitCode: process.exitCode ?? null,
        directory: '/protected',
        pendingName: 'pending',
        displacedName: 'displaced',
      }),
    ).toMatchObject({
      recoveryLocations: ['/protected/pending'],
    })
  })

  it('reports both protected artifacts when rollback is occupied and pending cleanup fails', () => {
    const { process, filesystem } = runFailedInstaller('replace')
    expect(process.exitCode).toBe(79)
    expect(filesystem.unlinkSync).toHaveBeenCalledWith('pending')
    const failure = profileCredentialInstallerFailure({
      exitCode: process.exitCode ?? null,
      directory: '/protected',
      pendingName: 'pending',
      displacedName: 'displaced',
    })
    expect(failure).toBeInstanceOf(ProfileCredentialInstallerRecoveryError)
    expect(failure).toMatchObject({
      recoveryLocations: ['/protected/pending', '/protected/displaced'],
    })
  })

  it('ignores only a pending file that has already been removed', () => {
    const { process } = runFailedInstaller('create', 'ENOENT')
    expect(process.exitCode).toBe(75)
    expect(process.stderr.write).not.toHaveBeenCalledWith(
      expect.stringContaining('Pending credential cleanup failed'),
    )
  })

  it('reports the displaced original when rollback linking fails but pending cleanup succeeds', () => {
    const { process } = runFailedInstaller('replace', 'ENOENT', 'link')
    expect(process.exitCode).toBe(77)
    expect(
      profileCredentialInstallerFailure({
        exitCode: process.exitCode ?? null,
        directory: '/protected',
        pendingName: 'pending',
        displacedName: 'displaced',
      }),
    ).toMatchObject({ recoveryLocations: ['/protected/displaced'] })
  })

  it('reports both artifacts when rollback unlink and pending cleanup both fail', () => {
    const { process } = runFailedInstaller('replace', 'EACCES', 'unlink')
    expect(process.exitCode).toBe(79)
    expect(
      profileCredentialInstallerFailure({
        exitCode: process.exitCode ?? null,
        directory: '/protected',
        pendingName: 'pending',
        displacedName: 'displaced',
      }),
    ).toMatchObject({
      recoveryLocations: ['/protected/pending', '/protected/displaced'],
    })
  })

  it('reports both possible artifacts after an indeterminate child exit', () => {
    expect(
      profileCredentialInstallerFailure({
        exitCode: null,
        directory: '/protected',
        pendingName: 'pending',
        displacedName: 'displaced',
      }),
    ).toMatchObject({
      recoveryLocations: ['/protected/pending', '/protected/displaced'],
    })
  })
})
