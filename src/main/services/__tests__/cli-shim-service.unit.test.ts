import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSafeChildEnv } from '../../env'
import { managedCliShimContent } from '../cli-shim-content'
import { createCliShimService, resolveCliShimExecutablePath } from '../cli-shim-service'

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

  function service(executablePath = '/Applications/OpenWaggle.app/Contents/MacOS/OpenWaggle') {
    return createCliShimService({
      platform: POSIX_TEST_PLATFORM,
      homeDirectory,
      executablePath,
      environmentPath: path.join(homeDirectory, '.local', 'bin'),
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
    if (POSIX_TEST_PLATFORM === 'linux') expect(content).toContain('OPENWAGGLE_CLI_OUTPUT_FD=3')
    else expect(content).toContain('exec')
    expect((await stat(commandPath)).mode & 0o111).toBe(0o111)

    await expect(cli.remove()).resolves.toMatchObject({
      ok: true,
      status: { state: 'not-installed' },
    })
  })

  itPosix('isolates Linux Electron stdout without filtering application bytes', async () => {
    const executablePath = path.join(homeDirectory, 'fake-electron')
    await writeFile(
      executablePath,
      `#!/bin/sh
if [ "$1" = "signal" ]; then
  trap 'printf terminated > "$3"; exit 0' HUP INT TERM
  printf ready > "$2"
  while :; do sleep 0.05; done
fi
printf '[]\\n{}\\nElectron diagnostic\\n'
if [ "$1" = "literal-data" ]; then
  printf '# Export\\n\\n## user\\n\\n{}\\n[]\\n' >&3
else
  printf '{"schemaVersion":1,"type":"record"}\\n' >&3
fi
if [ "$1" = "fail" ]; then exit 7; fi
`,
      { mode: 0o700 },
    )
    const commandPath = path.join(homeDirectory, '.local', 'bin', 'openwaggle')
    await mkdir(path.dirname(commandPath), { recursive: true })
    await writeFile(
      commandPath,
      managedCliShimContent({
        platform: 'linux',
        homeDirectory,
        executablePath,
        environmentPath: path.dirname(commandPath),
      }),
      { mode: 0o700 },
    )

    await expect(execFileAsync(commandPath, ['stream'])).resolves.toMatchObject({
      stdout: '{"schemaVersion":1,"type":"record"}\n',
    })
    await expect(execFileAsync(commandPath, ['literal-data'])).resolves.toMatchObject({
      stdout: '# Export\n\n## user\n\n{}\n[]\n',
    })
    await expect(execFileAsync(commandPath, ['fail'])).rejects.toMatchObject({ code: 7 })

    const readyPath = path.join(homeDirectory, 'child-ready')
    const terminatedPath = path.join(homeDirectory, 'child-terminated')
    const running = spawn(commandPath, ['signal', readyPath, terminatedPath], {
      env: getSafeChildEnv(),
      stdio: 'ignore',
    })
    try {
      await vi.waitFor(
        async () => {
          await expect(readFile(readyPath, 'utf8')).resolves.toBe('ready')
        },
        { timeout: 15_000 },
      )
      const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve) => running.once('exit', (code, signal) => resolve({ code, signal })),
      )
      expect(running.kill('SIGTERM')).toBe(true)
      await expect(exited).resolves.toMatchObject({ signal: null })
      await expect(readFile(terminatedPath, 'utf8')).resolves.toBe('terminated')
    } finally {
      if (running.exitCode === null && running.signalCode === null) running.kill('SIGKILL')
    }
  })

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

describe('CLI shim executable resolution', () => {
  const mountedExecutable = '/tmp/.mount_OpenWa/usr/bin/openwaggle'
  const originalAppImage = '/opt/OpenWaggle/OpenWaggle.AppImage'

  it('targets the original AppImage for a packaged Linux application', () => {
    expect(
      resolveCliShimExecutablePath({
        platform: 'linux',
        executablePath: mountedExecutable,
        isPackaged: true,
        appImagePath: originalAppImage,
      }),
    ).toBe(originalAppImage)
  })

  it.each([
    { platform: 'linux' as const, isPackaged: false, appImagePath: originalAppImage },
    { platform: 'darwin' as const, isPackaged: true, appImagePath: originalAppImage },
    { platform: 'linux' as const, isPackaged: true, appImagePath: 'relative.AppImage' },
    { platform: 'linux' as const, isPackaged: true, appImagePath: undefined },
  ])('keeps the executable path outside a packaged AppImage runtime: %o', (input) => {
    expect(resolveCliShimExecutablePath({ ...input, executablePath: mountedExecutable })).toBe(
      mountedExecutable,
    )
  })
})
