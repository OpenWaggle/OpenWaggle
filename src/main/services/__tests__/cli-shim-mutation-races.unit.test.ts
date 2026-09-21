import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCliShimService } from '../cli-shim-service'

const POSIX_TEST_PLATFORM: NodeJS.Platform = process.platform === 'darwin' ? 'darwin' : 'linux'
const itPosix = process.platform === 'win32' ? it.skip : it

describe('CLI shim mutation races', () => {
  let homeDirectory: string

  beforeEach(async () => {
    homeDirectory = await mkdtemp(path.join(os.tmpdir(), 'openwaggle-cli-shim-'))
  })

  afterEach(async () => {
    await rm(homeDirectory, { recursive: true, force: true })
  })

  function service(
    executablePath = '/Applications/OpenWaggle.app/Contents/MacOS/OpenWaggle',
    beforeManagedReplacement?: () => Promise<void>,
  ) {
    return createCliShimService({
      platform: POSIX_TEST_PLATFORM,
      homeDirectory,
      executablePath,
      environmentPath: path.join(homeDirectory, '.local', 'bin'),
      ...(beforeManagedReplacement ? { beforeManagedReplacement } : {}),
    })
  }

  itPosix('bounds the replacement gap inside the helper commit protocol', async () => {
    await service('/Applications/OpenWaggle-old.app/Contents/MacOS/OpenWaggle').install()
    const commandPath = path.join(homeDirectory, '.local', 'bin', 'openwaggle')
    let observedBoundedGap = false
    const current = createCliShimService({
      platform: POSIX_TEST_PLATFORM,
      homeDirectory,
      executablePath: '/Applications/OpenWaggle.app/Contents/MacOS/OpenWaggle',
      environmentPath: path.dirname(commandPath),
      afterManagedDisplacement: async () => {
        await expect(stat(commandPath)).rejects.toMatchObject({ code: 'ENOENT' })
        observedBoundedGap = true
      },
    })

    await expect(current.install()).resolves.toMatchObject({
      ok: true,
      status: { state: 'installed' },
    })
    expect(observedBoundedGap).toBe(true)
    await expect(readFile(commandPath, 'utf8')).resolves.not.toContain('OpenWaggle-old.app')
  })

  itPosix('does not follow or clean up a hostile pending-name symlink', async () => {
    const commandDirectory = path.join(homeDirectory, '.local', 'bin')
    const protectedPath = path.join(homeDirectory, 'protected-user-file')
    await writeFile(protectedPath, 'user-owned')
    let hostilePendingPath: string | undefined
    const current = createCliShimService({
      platform: POSIX_TEST_PLATFORM,
      homeDirectory,
      executablePath: '/Applications/OpenWaggle.app/Contents/MacOS/OpenWaggle',
      environmentPath: commandDirectory,
      beforeManagedSpawn: async ({ directory, pendingName }) => {
        hostilePendingPath = path.join(directory, pendingName)
        await symlink(protectedPath, hostilePendingPath)
      },
    })

    await expect(current.install()).resolves.toMatchObject({
      ok: false,
      status: { state: 'not-installed' },
    })
    await expect(readFile(protectedPath, 'utf8')).resolves.toBe('user-owned')
    if (!hostilePendingPath) throw new Error('The test did not capture the hostile pending path.')
    expect((await lstat(hostilePendingPath)).isSymbolicLink()).toBe(true)
  })

  itPosix('does not overwrite a user file that replaces an outdated shim', async () => {
    await service('/Applications/OpenWaggle-old.app/Contents/MacOS/OpenWaggle').install()
    const commandPath = path.join(homeDirectory, '.local', 'bin', 'openwaggle')
    const current = service('/Applications/OpenWaggle.app/Contents/MacOS/OpenWaggle', async () => {
      await unlink(commandPath)
      await writeFile(commandPath, '#!/bin/sh\necho user-owned\n', 'utf8')
    })

    await expect(current.install()).resolves.toMatchObject({
      ok: false,
      status: { state: 'conflict' },
    })
    await expect(readFile(commandPath, 'utf8')).resolves.toContain('user-owned')
  })

  itPosix('retains a user file raced in after replacement revalidation', async () => {
    await service('/Applications/OpenWaggle-old.app/Contents/MacOS/OpenWaggle').install()
    const commandPath = path.join(homeDirectory, '.local', 'bin', 'openwaggle')
    const current = createCliShimService({
      platform: POSIX_TEST_PLATFORM,
      homeDirectory,
      executablePath: '/Applications/OpenWaggle.app/Contents/MacOS/OpenWaggle',
      environmentPath: path.dirname(commandPath),
      beforeManagedCommit: async () => {
        await unlink(commandPath)
        await writeFile(commandPath, '#!/bin/sh\necho late-user-owned\n', 'utf8')
      },
    })

    await expect(current.install()).resolves.toMatchObject({
      ok: false,
      status: { state: 'conflict' },
    })
    await expect(readFile(commandPath, 'utf8')).resolves.toContain('late-user-owned')
  })

  itPosix('reports the preserved shim when the target is occupied during commit', async () => {
    await service('/Applications/OpenWaggle-old.app/Contents/MacOS/OpenWaggle').install()
    const commandPath = path.join(homeDirectory, '.local', 'bin', 'openwaggle')
    const current = createCliShimService({
      platform: POSIX_TEST_PLATFORM,
      homeDirectory,
      executablePath: '/Applications/OpenWaggle.app/Contents/MacOS/OpenWaggle',
      environmentPath: path.dirname(commandPath),
      afterManagedDisplacement: async () => {
        await writeFile(commandPath, '#!/bin/sh\necho commit-user-owned\n', 'utf8')
      },
    })

    const result = await current.install()

    expect(result).toMatchObject({ ok: false, status: { state: 'conflict' } })
    if (result.ok) throw new Error('Expected the occupied commit to fail safely.')
    await expect(readFile(commandPath, 'utf8')).resolves.toContain('commit-user-owned')
    const recoveryPath = result.error.match(/recoverable at (.+)\.$/)?.[1]
    if (!recoveryPath) throw new Error('Expected a recoverable CLI shim path.')
    await expect(readFile(recoveryPath, 'utf8')).resolves.toContain('OpenWaggle-old.app')
  })

  itPosix('retains a user file raced in after removal revalidation', async () => {
    const current = service()
    await current.install()
    const commandPath = path.join(homeDirectory, '.local', 'bin', 'openwaggle')
    const racingRemoval = createCliShimService({
      platform: POSIX_TEST_PLATFORM,
      homeDirectory,
      executablePath: '/Applications/OpenWaggle.app/Contents/MacOS/OpenWaggle',
      environmentPath: path.dirname(commandPath),
      beforeManagedCommit: async () => {
        await unlink(commandPath)
        await writeFile(commandPath, '#!/bin/sh\necho late-removal-user-owned\n', 'utf8')
      },
    })

    await expect(racingRemoval.remove()).resolves.toMatchObject({
      ok: false,
      status: { state: 'conflict' },
    })
    await expect(readFile(commandPath, 'utf8')).resolves.toContain('late-removal-user-owned')
  })

  itPosix('does not clean up a pending name replaced by a hostile symlink', async () => {
    await service('/Applications/OpenWaggle-old.app/Contents/MacOS/OpenWaggle').install()
    const commandPath = path.join(homeDirectory, '.local', 'bin', 'openwaggle')
    const protectedPath = path.join(homeDirectory, 'late-protected-user-file')
    await writeFile(protectedPath, 'late-user-owned')
    let pendingPath: string | undefined
    const current = createCliShimService({
      platform: POSIX_TEST_PLATFORM,
      homeDirectory,
      executablePath: '/Applications/OpenWaggle.app/Contents/MacOS/OpenWaggle',
      environmentPath: path.dirname(commandPath),
      beforeManagedSpawn: async ({ directory, pendingName }) => {
        pendingPath = path.join(directory, pendingName)
      },
      beforeManagedCommit: async () => {
        if (!pendingPath) throw new Error('The test did not capture the pending path.')
        await unlink(pendingPath)
        await symlink(protectedPath, pendingPath)
      },
    })

    await expect(current.install()).resolves.toMatchObject({
      ok: false,
      status: { state: 'outdated' },
    })
    await expect(readFile(protectedPath, 'utf8')).resolves.toBe('late-user-owned')
    if (!pendingPath) throw new Error('The test did not capture the replaced pending path.')
    expect((await lstat(pendingPath)).isSymbolicLink()).toBe(true)
    await expect(readFile(commandPath, 'utf8')).resolves.toContain('OpenWaggle-old.app')
  })

  itPosix(
    'keeps replacement pinned when the command directory is moved after validation',
    async () => {
      await service('/Applications/OpenWaggle-old.app/Contents/MacOS/OpenWaggle').install()
      const commandDirectory = path.join(homeDirectory, '.local', 'bin')
      const movedDirectory = path.join(homeDirectory, '.local', 'bin-authorized')
      const outsideDirectory = path.join(homeDirectory, 'outside-bin')
      await mkdir(outsideDirectory)
      await writeFile(path.join(outsideDirectory, 'openwaggle'), 'outside user data')
      const current = service(
        '/Applications/OpenWaggle.app/Contents/MacOS/OpenWaggle',
        async () => {
          await rename(commandDirectory, movedDirectory)
          await symlink(outsideDirectory, commandDirectory)
        },
      )

      await expect(current.install()).resolves.toMatchObject({ ok: true })
      await expect(readFile(path.join(outsideDirectory, 'openwaggle'), 'utf8')).resolves.toBe(
        'outside user data',
      )
      await expect(
        readFile(path.join(movedDirectory, 'openwaggle'), 'utf8'),
      ).resolves.not.toContain('OpenWaggle-old.app')
    },
  )

  itPosix('rejects a command directory replaced before the helper pins it', async () => {
    await service('/Applications/OpenWaggle-old.app/Contents/MacOS/OpenWaggle').install()
    const commandDirectory = path.join(homeDirectory, '.local', 'bin')
    const movedDirectory = `${homeDirectory}-outside-pre-spawn`
    const current = createCliShimService({
      platform: POSIX_TEST_PLATFORM,
      homeDirectory,
      executablePath: '/Applications/OpenWaggle.app/Contents/MacOS/OpenWaggle',
      environmentPath: commandDirectory,
      beforeManagedSpawn: async () => {
        await rename(commandDirectory, movedDirectory)
        await symlink(movedDirectory, commandDirectory)
      },
    })

    await expect(current.install()).resolves.toMatchObject({ ok: false })
    await expect(readFile(path.join(movedDirectory, 'openwaggle'), 'utf8')).resolves.toContain(
      'OpenWaggle-old.app',
    )
    await rm(movedDirectory, { recursive: true, force: true })
  })
})
