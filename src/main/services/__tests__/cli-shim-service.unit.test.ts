import { execFile, spawn } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  readdir,
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
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSafeChildEnv } from '../../env'
import { managedCliShimContent } from '../cli-shim-content'
import { createCliShimService } from '../cli-shim-service'

const POSIX_TEST_PLATFORM: NodeJS.Platform = process.platform === 'darwin' ? 'darwin' : 'linux'
const itPosix = process.platform === 'win32' ? it.skip : it
const execFileAsync = promisify(execFile)

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
      platform: POSIX_TEST_PLATFORM,
      homeDirectory,
      executablePath,
      environmentPath: path.join(homeDirectory, '.local', 'bin'),
      ...(beforeManagedReplacement ? { beforeManagedReplacement } : {}),
    })
  }

  itPosix('installs an executable user shim and removes only its managed file', async () => {
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
    const content = await readFile(commandPath, 'utf8')
    expect(content).toContain("'/Applications/OpenWaggle.app")
    if (POSIX_TEST_PLATFORM === 'linux') expect(content).toContain('mkfifo')
    else expect(content).toContain('exec')
    expect((await stat(commandPath)).mode & 0o111).toBe(0o111)

    await expect(cli.remove()).resolves.toMatchObject({
      ok: true,
      status: { state: 'not-installed' },
    })
  })

  itPosix(
    'normalizes only a leading Linux Electron payload and preserves exit status',
    async () => {
      const executablePath = path.join(homeDirectory, 'fake-electron')
      await writeFile(
        executablePath,
        `#!/bin/sh
if [ "$1" = "empty" ]; then
  printf '[]\\n'
  exit 0
fi
if [ "$1" = "signal" ]; then
  trap 'printf terminated > "$3"; exit 0' HUP INT TERM
  printf ready > "$2"
  while :; do sleep 0.05; done
fi
if [ "$1" = "colored" ]; then
  printf '\\033[90m[]\\033[39m\\n\\033[90m{}\\033[39m\\n{"schemaVersion":1,"type":"record"}\\n\\033[90m[]\\033[39m\\n'
  exit 0
fi
if [ "$1" = "colored-empty" ]; then
  printf '\\033[90m[]\\033[39m\\n'
  exit 0
fi
if [ "$1" = "concatenated" ]; then
  printf '\\033[?25l[]\\033[?25h{}\\033[2K{"schemaVersion":1,"type":"record"}[]'
  exit 0
fi
if [ "$1" = "diagnostic" ]; then
  printf '[]diagnostic\\n{"schemaVersion":1,"type":"record"}\\n'
  exit 0
fi
printf '[]\\n{}\\n{"schemaVersion":1,"type":"record"}\\n'
if [ "$1" = "fail" ]; then exit 7; fi
`,
        { mode: 0o700 },
      )
      const shimInput = {
        platform: 'linux',
        homeDirectory,
        executablePath,
        environmentPath: path.join(homeDirectory, '.local', 'bin'),
      } satisfies Parameters<typeof managedCliShimContent>[0]
      const commandPath = path.join(homeDirectory, '.local', 'bin', 'openwaggle')
      await mkdir(path.dirname(commandPath), { recursive: true })
      await writeFile(commandPath, managedCliShimContent(shimInput), { mode: 0o700 })

      await expect(execFileAsync(commandPath, ['stream'])).resolves.toMatchObject({
        stdout: '{"schemaVersion":1,"type":"record"}\n',
      })
      await expect(execFileAsync(commandPath, ['colored'])).resolves.toMatchObject({
        stdout: '{"schemaVersion":1,"type":"record"}\n',
      })
      await expect(execFileAsync(commandPath, ['colored-empty'])).resolves.toMatchObject({
        stdout: '\u001B[90m[]\u001B[39m\n',
      })
      await expect(execFileAsync(commandPath, ['concatenated'])).resolves.toMatchObject({
        stdout: '{"schemaVersion":1,"type":"record"}\n',
      })
      await expect(execFileAsync(commandPath, ['diagnostic'])).resolves.toMatchObject({
        stdout: '[]diagnostic\n{"schemaVersion":1,"type":"record"}\n',
      })
      await expect(execFileAsync(commandPath, ['empty'])).resolves.toMatchObject({ stdout: '[]\n' })
      await expect(execFileAsync(commandPath, ['fail'])).rejects.toMatchObject({ code: 7 })

      const shimTemp = path.join(homeDirectory, 'shim-temp')
      const readyPath = path.join(homeDirectory, 'child-ready')
      const terminatedPath = path.join(homeDirectory, 'child-terminated')
      await mkdir(shimTemp)
      const running = spawn(commandPath, ['signal', readyPath, terminatedPath], {
        env: { ...getSafeChildEnv(), TMPDIR: shimTemp },
        stdio: 'ignore',
      })
      await vi.waitFor(async () => {
        await expect(readFile(readyPath, 'utf8')).resolves.toBe('ready')
      })
      const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve) => running.once('exit', (code, signal) => resolve({ code, signal })),
      )
      expect(running.kill('SIGTERM')).toBe(true)
      await expect(exited).resolves.toMatchObject({ signal: null })
      await expect(readFile(terminatedPath, 'utf8')).resolves.toBe('terminated')
      await expect(readdir(shimTemp)).resolves.toEqual([])
    },
  )

  itPosix('refuses to replace or remove an unrelated command', async () => {
    const commandPath = path.join(homeDirectory, '.local', 'bin', 'openwaggle')
    await mkdir(path.dirname(commandPath), { recursive: true })
    await writeFile(commandPath, '#!/bin/sh\necho unrelated\n')
    const cli = service()

    await expect(cli.install()).resolves.toMatchObject({ ok: false, status: { state: 'conflict' } })
    await expect(cli.remove()).resolves.toMatchObject({ ok: false, status: { state: 'conflict' } })
    await expect(readFile(commandPath, 'utf8')).resolves.toContain('unrelated')
  })

  itPosix('updates a previously managed shim after the application path changes', async () => {
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

  itPosix(
    'does not overwrite a user file that replaces an outdated shim during update',
    async () => {
      await service('/Applications/OpenWaggle-old.app/Contents/MacOS/OpenWaggle').install()
      const commandPath = path.join(homeDirectory, '.local', 'bin', 'openwaggle')
      const current = service(
        '/Applications/OpenWaggle.app/Contents/MacOS/OpenWaggle',
        async () => {
          await unlink(commandPath)
          await writeFile(commandPath, '#!/bin/sh\necho user-owned\n', 'utf8')
        },
      )

      await expect(current.install()).resolves.toMatchObject({
        ok: false,
        status: { state: 'conflict' },
      })
      await expect(readFile(commandPath, 'utf8')).resolves.toContain('user-owned')
    },
  )

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
