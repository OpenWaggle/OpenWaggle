import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fileShellEnvironmentCache,
  SHELL_ENVIRONMENT_CACHE_MAX_AGE_MS,
} from '../desktop-shell-environment-cache'
import type {
  ShellEnvironmentCommand,
  ShellEnvironmentCommandRunner,
} from '../desktop-shell-environment-probes'
import { startDesktopShellEnvironment } from '../desktop-shell-environment-start'
import { captured, inheritingLoginShell } from './desktop-shell-environment-cache-fixtures'

const NOW = 1_800_000_000_000
const KEY = { platform: 'darwin' as const, shell: '/bin/zsh', home: '/Users/test' }

/** A login shell whose answer the test releases, like a `.zshrc` that takes its time. */
function slowLoginShell(output: string) {
  const answer = Promise.withResolvers<void>()
  const runCommand = vi.fn(async (input: ShellEnvironmentCommand) => {
    if (input.probe !== 'login-shell') return ''
    await answer.promise
    return output
  })
  return { runCommand, answer }
}

let directory = ''
let cacheFile = ''

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'openwaggle-shell-cache-'))
  cacheFile = path.join(directory, 'shell-environment.json')
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

function launch(runCommand: ShellEnvironmentCommandRunner, extra: Record<string, string> = {}) {
  const env: Record<string, string | undefined> = {
    PATH: '/usr/bin:/bin',
    SHELL: '/bin/zsh',
    HOME: '/Users/test',
    LANG: 'en_US.UTF-8',
    ...extra,
  }
  const started = startDesktopShellEnvironment({
    env,
    platform: 'darwin',
    runCommand,
    cache: fileShellEnvironmentCache(cacheFile),
    now: () => NOW,
  })
  return { env, started }
}

describe('the cached login-shell environment', () => {
  it('waits for the probe on a first launch, then caches what it found', async () => {
    const shell = slowLoginShell(
      captured('PATH', '/opt/homebrew/bin:/usr/bin') + captured('SSH_AUTH_SOCK', '/tmp/agent'),
    )
    const { env, started } = launch(shell.runCommand)
    let ready = false
    void started.ready.then(() => {
      ready = true
    })
    await Promise.resolve()

    expect(started.fromCache).toBe(false)
    expect(ready).toBe(false)
    shell.answer.resolve()
    await started.ready
    expect(env.PATH).toBe('/opt/homebrew/bin:/usr/bin:/bin')
    const cached: unknown = JSON.parse(await readFile(cacheFile, 'utf8'))
    expect(cached).toMatchObject({
      ...KEY,
      resolvedAt: NOW,
      environment: { PATH: '/opt/homebrew/bin:/usr/bin', SSH_AUTH_SOCK: '/tmp/agent' },
    })
    // Private to the user, like the profile it belongs to.
    expect((await stat(cacheFile)).mode & 0o777).toBe(0o600)
  })

  it('uses the cached environment at once, then applies the refreshed one over it', async () => {
    fileShellEnvironmentCache(cacheFile).write(
      KEY,
      { environment: { PATH: '/cached/bin:/usr/bin', SSH_AUTH_SOCK: '/tmp/old-agent' } },
      NOW - 1_000,
    )
    const shell = slowLoginShell(
      captured('PATH', '/fresh/bin:/usr/bin') + captured('SSH_AUTH_SOCK', '/tmp/new-agent'),
    )
    const { env, started } = launch(shell.runCommand)

    await started.ready
    expect(started.fromCache).toBe(true)
    expect(env.PATH).toBe('/cached/bin:/usr/bin:/bin')
    expect(env.SSH_AUTH_SOCK).toBe('/tmp/old-agent')

    shell.answer.resolve()
    await started.refreshed
    // Rebuilt from the launch environment: the cached entries do not linger.
    expect(env.PATH).toBe('/fresh/bin:/usr/bin:/bin')
    expect(env.SSH_AUTH_SOCK).toBe('/tmp/new-agent')
    expect(fileShellEnvironmentCache(cacheFile).read(KEY, NOW)).toEqual({
      environment: { PATH: '/fresh/bin:/usr/bin', SSH_AUTH_SOCK: '/tmp/new-agent' },
      resolvedAt: NOW,
    })
  })

  it('keeps the cached environment when the refresh finds nothing', async () => {
    fileShellEnvironmentCache(cacheFile).write(KEY, { environment: { PATH: '/cached/bin' } }, NOW)
    const shell = slowLoginShell('')
    const { env, started } = launch(shell.runCommand)
    shell.answer.resolve()
    await started.refreshed

    expect(env.PATH).toBe('/cached/bin:/usr/bin:/bin')
    expect(fileShellEnvironmentCache(cacheFile).read(KEY, NOW)).toEqual({
      environment: { PATH: '/cached/bin' },
      resolvedAt: NOW,
    })
  })

  it("does not use another shell's, another HOME's, or a month-old environment", () => {
    const cache = fileShellEnvironmentCache(cacheFile)
    cache.write(KEY, { environment: { PATH: '/cached/bin' } }, NOW)

    expect(cache.read({ ...KEY, shell: '/bin/bash' }, NOW)).toBeNull()
    expect(cache.read({ ...KEY, home: '/Users/other' }, NOW)).toBeNull()
    expect(cache.read(KEY, NOW + SHELL_ENVIRONMENT_CACHE_MAX_AGE_MS + 1)).toBeNull()
    expect(cache.read(KEY, NOW)).not.toBeNull()
  })

  it('never reads or writes a variable outside the probe allowlist', async () => {
    fileShellEnvironmentCache(cacheFile).write(
      KEY,
      { environment: { PATH: '/cached/bin', OPENAI_API_KEY: 'sk-secret' } },
      NOW,
    )
    expect(await readFile(cacheFile, 'utf8')).not.toContain('sk-secret')

    const raw = JSON.parse(await readFile(cacheFile, 'utf8'))
    raw.environment.ELECTRON_RUN_AS_NODE = '1'
    await writeFile(cacheFile, JSON.stringify(raw))
    expect(fileShellEnvironmentCache(cacheFile).read(KEY, NOW)).toEqual({
      environment: { PATH: '/cached/bin' },
      resolvedAt: NOW,
    })
  })

  it('ignores a malformed cache file and probes instead', async () => {
    await writeFile(cacheFile, '{"version":1,"environment":"not an object"}')
    const shell = slowLoginShell(captured('PATH', '/fresh/bin'))
    const { started } = launch(shell.runCommand)

    expect(started.fromCache).toBe(false)
    shell.answer.resolve()
    await started.ready
  })

  it('refreshes from the launch environment, not from the one the cache applied', async () => {
    fileShellEnvironmentCache(cacheFile).write(
      KEY,
      { environment: { PATH: '/stale/venv/bin:/usr/bin:/bin' } },
      NOW - 1_000,
    )
    const shell = inheritingLoginShell('/opt/homebrew/bin')
    const { env, started } = launch(shell.runCommand)
    expect(env.PATH).toBe('/stale/venv/bin:/usr/bin:/bin')
    await started.refreshed

    expect(shell.inherited).toHaveLength(1)
    expect(shell.inherited[0]?.PATH).toBe('/usr/bin:/bin')
    // A PATH entry only the cache had is gone, from the process and from the cache.
    expect(env.PATH).toBe('/opt/homebrew/bin:/usr/bin:/bin')
    expect(fileShellEnvironmentCache(cacheFile).read(KEY, NOW)).toEqual({
      environment: { PATH: '/opt/homebrew/bin:/usr/bin:/bin' },
      resolvedAt: NOW,
    })
  })

  it("never lets a cached desktop-session value replace the launch's", async () => {
    fileShellEnvironmentCache(cacheFile).write(
      KEY,
      { environment: { PATH: '/usr/bin', XDG_SESSION_TYPE: 'x11' } },
      NOW - 1_000,
    )
    const shell = inheritingLoginShell('/opt/homebrew/bin')
    const { env, started } = launch(shell.runCommand, { XDG_SESSION_TYPE: 'wayland' })
    await started.ready
    expect(env.XDG_SESSION_TYPE).toBe('wayland')

    await started.refreshed
    expect(shell.inherited[0]?.XDG_SESSION_TYPE).toBe('wayland')
    expect(env.XDG_SESSION_TYPE).toBe('wayland')
    expect(fileShellEnvironmentCache(cacheFile).read(KEY, NOW)?.environment.XDG_SESSION_TYPE).toBe(
      'wayland',
    )
  })

  it('resets a cached variable the refresh no longer reports to its launch value', async () => {
    fileShellEnvironmentCache(cacheFile).write(
      KEY,
      { environment: { PATH: '/usr/bin', SSH_AUTH_SOCK: '/tmp/old-agent' } },
      NOW - 1_000,
    )
    const shell = inheritingLoginShell('/opt/homebrew/bin')
    const { env, started } = launch(shell.runCommand)
    await started.ready
    expect(env.SSH_AUTH_SOCK).toBe('/tmp/old-agent')

    await started.refreshed
    expect(shell.inherited[0]?.SSH_AUTH_SOCK).toBeUndefined()
    expect('SSH_AUTH_SOCK' in env).toBe(false)
    expect(fileShellEnvironmentCache(cacheFile).read(KEY, NOW)?.environment).not.toHaveProperty(
      'SSH_AUTH_SOCK',
    )
  })
})

describe('a Session Host launched by the desktop app', () => {
  const SINCE = NOW - 500

  /** The Host's start: it reads the cache but never writes it, and waits for the app's refresh. */
  function launchHost(input: {
    readonly runCommand: ShellEnvironmentCommandRunner
    readonly duringWait?: (elapsedMs: number) => void
  }) {
    let clock = NOW
    const env: Record<string, string | undefined> = {
      PATH: '/usr/bin:/bin',
      SHELL: '/bin/zsh',
      HOME: '/Users/test',
      LANG: 'en_US.UTF-8',
    }
    const started = startDesktopShellEnvironment({
      env,
      platform: 'darwin',
      runCommand: input.runCommand,
      cache: fileShellEnvironmentCache(cacheFile),
      writeCache: false,
      refreshedElsewhere: { since: SINCE, timeoutMs: 1_000 },
      now: () => clock,
      sleep: async (milliseconds) => {
        clock += milliseconds
        input.duringWait?.(clock - NOW)
      },
    })
    return { env, started }
  }

  it("runs no login shell when the app's refresh for this launch is already cached", async () => {
    fileShellEnvironmentCache(cacheFile).write(KEY, { environment: { PATH: '/fresh/bin' } }, SINCE)
    const runCommand = vi.fn(async () => captured('PATH', '/probed/bin'))
    const { env, started } = launchHost({ runCommand })

    await started.ready
    await started.refreshed
    expect(runCommand).not.toHaveBeenCalled()
    expect(env.PATH).toBe('/fresh/bin:/usr/bin:/bin')
  })

  it("applies the app's refresh once it is written, still without a login shell", async () => {
    fileShellEnvironmentCache(cacheFile).write(
      KEY,
      { environment: { PATH: '/old/bin' } },
      NOW - 1e6,
    )
    const runCommand = vi.fn(async () => captured('PATH', '/probed/bin'))
    const { env, started } = launchHost({
      runCommand,
      duringWait: (elapsedMs) => {
        if (elapsedMs !== 300) return
        fileShellEnvironmentCache(cacheFile).write(KEY, { environment: { PATH: '/app/bin' } }, NOW)
      },
    })
    await started.ready
    expect(env.PATH).toBe('/old/bin:/usr/bin:/bin')

    await started.refreshed
    expect(runCommand).not.toHaveBeenCalled()
    expect(env.PATH).toBe('/app/bin:/usr/bin:/bin')
  })

  it('probes itself when the app has not refreshed in time, and leaves the cache to the app', async () => {
    fileShellEnvironmentCache(cacheFile).write(
      KEY,
      { environment: { PATH: '/old/bin' } },
      NOW - 1e6,
    )
    const runCommand = vi.fn(async (input: ShellEnvironmentCommand) =>
      input.probe === 'login-shell' ? captured('PATH', '/terminal/venv/bin:/usr/bin') : '',
    )
    const { env, started } = launchHost({ runCommand })
    await started.refreshed

    expect(runCommand).toHaveBeenCalled()
    expect(env.PATH).toBe('/terminal/venv/bin:/usr/bin:/bin')
    // A Host's environment can be a terminal's; it never becomes every launch's.
    expect(fileShellEnvironmentCache(cacheFile).read(KEY, NOW)?.environment.PATH).toBe('/old/bin')
  })
})
