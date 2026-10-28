import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startDesktopShellEnvironment } from '../desktop-shell-environment'
import {
  fileShellEnvironmentCache,
  SHELL_ENVIRONMENT_CACHE_MAX_AGE_MS,
} from '../desktop-shell-environment-cache'
import type {
  ShellEnvironmentCommand,
  ShellEnvironmentCommandRunner,
} from '../desktop-shell-environment-probes'

const NOW = 1_800_000_000_000
const KEY = { platform: 'darwin' as const, shell: '/bin/zsh', home: '/Users/test' }

function captured(name: string, value: string) {
  return `__OPENWAGGLE_ENV_${name}_START__\n${value}\n__OPENWAGGLE_ENV_${name}_END__\n`
}

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

/**
 * A login shell that behaves like zsh with `path_helper` and a `.zshrc`: it keeps the PATH and the
 * desktop-session variables it inherits, and adds its own PATH entry in front.
 */
function inheritingLoginShell(added: string) {
  const inherited: (Readonly<Record<string, string | undefined>> | undefined)[] = []
  const runCommand = vi.fn(async (input: ShellEnvironmentCommand) => {
    if (input.probe !== 'login-shell') return ''
    inherited.push(input.env)
    const env = input.env ?? {}
    return [
      captured('PATH', `${added}:${env.PATH ?? ''}`),
      env.XDG_SESSION_TYPE ? captured('XDG_SESSION_TYPE', env.XDG_SESSION_TYPE) : '',
      env.SSH_AUTH_SOCK ? captured('SSH_AUTH_SOCK', env.SSH_AUTH_SOCK) : '',
    ].join('')
  })
  return { runCommand, inherited }
}

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
