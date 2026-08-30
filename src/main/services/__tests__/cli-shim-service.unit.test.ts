import {
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

describe('CLI shim service', () => {
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
      platform: 'darwin',
      homeDirectory,
      executablePath,
      environmentPath: path.join(homeDirectory, '.local', 'bin'),
      ...(beforeManagedReplacement ? { beforeManagedReplacement } : {}),
    })
  }

  it('installs an executable user shim and removes only its managed file', async () => {
    const cli = service()

    await expect(cli.status()).resolves.toMatchObject({
      management: 'user-shim',
      state: 'not-installed',
      onPath: true,
    })
    await expect(cli.install()).resolves.toMatchObject({
      ok: true,
      status: { state: 'installed' },
    })

    const commandPath = path.join(homeDirectory, '.local', 'bin', 'openwaggle')
    expect(await readFile(commandPath, 'utf8')).toContain("exec '/Applications/OpenWaggle.app")
    expect((await stat(commandPath)).mode & 0o111).toBe(0o111)

    await expect(cli.remove()).resolves.toMatchObject({
      ok: true,
      status: { state: 'not-installed' },
    })
  })

  it('refuses to replace or remove an unrelated command', async () => {
    const commandPath = path.join(homeDirectory, '.local', 'bin', 'openwaggle')
    await mkdir(path.dirname(commandPath), { recursive: true })
    await writeFile(commandPath, '#!/bin/sh\necho unrelated\n')
    const cli = service()

    await expect(cli.install()).resolves.toMatchObject({ ok: false, status: { state: 'conflict' } })
    await expect(cli.remove()).resolves.toMatchObject({ ok: false, status: { state: 'conflict' } })
    await expect(readFile(commandPath, 'utf8')).resolves.toContain('unrelated')
  })

  it('updates a previously managed shim after the application path changes', async () => {
    await service('/Applications/OpenWaggle-old.app/Contents/MacOS/OpenWaggle').install()
    const current = service('/Applications/OpenWaggle.app/Contents/MacOS/OpenWaggle')

    await expect(current.status()).resolves.toMatchObject({ state: 'outdated' })
    await expect(current.install()).resolves.toMatchObject({
      ok: true,
      status: { state: 'installed' },
    })
    await expect(
      readFile(path.join(homeDirectory, '.local', 'bin', 'openwaggle'), 'utf8'),
    ).resolves.not.toContain('OpenWaggle-old.app')
  })

  it('does not overwrite a user file that replaces an outdated shim during update', async () => {
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

  it('keeps replacement pinned when the command directory is moved after validation', async () => {
    await service('/Applications/OpenWaggle-old.app/Contents/MacOS/OpenWaggle').install()
    const commandDirectory = path.join(homeDirectory, '.local', 'bin')
    const movedDirectory = path.join(homeDirectory, '.local', 'bin-authorized')
    const outsideDirectory = path.join(homeDirectory, 'outside-bin')
    await mkdir(outsideDirectory)
    await writeFile(path.join(outsideDirectory, 'openwaggle'), 'outside user data')
    const current = service('/Applications/OpenWaggle.app/Contents/MacOS/OpenWaggle', async () => {
      await rename(commandDirectory, movedDirectory)
      await symlink(outsideDirectory, commandDirectory)
    })

    await expect(current.install()).resolves.toMatchObject({ ok: true })
    await expect(readFile(path.join(outsideDirectory, 'openwaggle'), 'utf8')).resolves.toBe(
      'outside user data',
    )
    await expect(readFile(path.join(movedDirectory, 'openwaggle'), 'utf8')).resolves.not.toContain(
      'OpenWaggle-old.app',
    )
  })

  it('rejects a command directory replaced before the helper pins it', async () => {
    await service('/Applications/OpenWaggle-old.app/Contents/MacOS/OpenWaggle').install()
    const commandDirectory = path.join(homeDirectory, '.local', 'bin')
    const movedDirectory = `${homeDirectory}-outside-pre-spawn`
    const current = createCliShimService({
      platform: 'darwin',
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

  it('leaves command management to the Windows installer', async () => {
    const cli = createCliShimService({
      platform: 'win32',
      homeDirectory,
      executablePath: 'C:\\Program Files\\OpenWaggle\\OpenWaggle.exe',
    })

    await expect(cli.status()).resolves.toMatchObject({
      management: 'installer',
      state: 'installed',
      commandPath: null,
    })
    await expect(cli.install()).resolves.toMatchObject({ ok: false })
  })
})
