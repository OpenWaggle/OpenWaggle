import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fileShellEnvironmentCache } from '../desktop-shell-environment-cache'
import type {
  ShellEnvironmentCommand,
  ShellEnvironmentCommandRunner,
} from '../desktop-shell-environment-probes'
import { startDesktopShellEnvironment } from '../desktop-shell-environment-start'
import { captured, inheritingLoginShell } from './desktop-shell-environment-cache-fixtures'

const NOW = 1_800_000_000_000
const SINCE = NOW - 500
const KEY = { platform: 'darwin' as const, shell: '/bin/zsh', home: '/Users/test' }

let directory = ''
let cacheFile = ''

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'openwaggle-shell-cache-refresh-'))
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

/* Review V1 P3-2: a GUI started from a terminal cached that terminal's PATH for every launch. */
describe('what the desktop app caches of its refresh', () => {
  it('does not cache the PATH entries a terminal launch brought with it', async () => {
    const shell = inheritingLoginShell('/opt/homebrew/bin')
    const { env, started } = launch(shell.runCommand, { PATH: '/proj/.venv/bin:/usr/bin:/bin' })
    await started.refreshed

    // This launch keeps its terminal's entries...
    expect(env.PATH).toBe('/opt/homebrew/bin:/proj/.venv/bin:/usr/bin:/bin')
    // ...but the next Dock launch, and every Host that reads the cache, does not get them.
    expect(fileShellEnvironmentCache(cacheFile).read(KEY, NOW)?.environment.PATH).toBe(
      '/opt/homebrew/bin:/usr/bin:/bin',
    )
  })

  it('keeps a launch PATH entry in the cache when the last cached result had it', async () => {
    fileShellEnvironmentCache(cacheFile).write(
      KEY,
      { environment: { PATH: '/opt/homebrew/bin:/usr/bin:/bin' } },
      NOW - 1_000,
    )
    const shell = inheritingLoginShell('/Users/test/.local/bin')
    const { started } = launch(shell.runCommand, {
      PATH: '/proj/.venv/bin:/opt/homebrew/bin:/usr/bin:/bin',
    })
    await started.refreshed

    expect(fileShellEnvironmentCache(cacheFile).read(KEY, NOW)?.environment.PATH).toBe(
      '/Users/test/.local/bin:/opt/homebrew/bin:/usr/bin:/bin',
    )
  })

  it('marks a refresh that found nothing, keeping the last good result', async () => {
    fileShellEnvironmentCache(cacheFile).write(
      KEY,
      { environment: { PATH: '/opt/homebrew/bin' } },
      NOW - 1_000,
    )
    const { started } = launch(vi.fn(async () => ''))
    await started.refreshed

    const cache = fileShellEnvironmentCache(cacheFile)
    expect(cache.refreshFailedAt(KEY)).toBe(NOW)
    expect(cache.read(KEY, NOW)?.environment.PATH).toBe('/opt/homebrew/bin')
    // A later refresh that succeeds clears the mark.
    cache.write(KEY, { environment: { PATH: '/usr/bin' } }, NOW)
    expect(cache.refreshFailedAt(KEY)).toBeNull()
  })
})

/*
 * Review V1 P3-3: the app wrote nothing when its refresh found nothing, so a Host without a cache
 * waited the whole 12 s for it before it probed itself.
 */
describe('a Session Host whose app refresh found nothing', () => {
  it("probes at once when the app's refresh found nothing, without waiting out the timeout", async () => {
    const probedAt: number[] = []
    let clock = NOW
    const runCommand = vi.fn(async (input: ShellEnvironmentCommand) => {
      if (input.probe !== 'login-shell') return ''
      probedAt.push(clock - NOW)
      return captured('PATH', '/probed/bin')
    })
    const env: Record<string, string | undefined> = {
      PATH: '/usr/bin:/bin',
      SHELL: '/bin/zsh',
      HOME: '/Users/test',
      LANG: 'en_US.UTF-8',
    }
    // No cache at all: a fresh install, so `ready` waits for the refresh.
    const started = startDesktopShellEnvironment({
      env,
      platform: 'darwin',
      runCommand,
      cache: fileShellEnvironmentCache(cacheFile),
      writeCache: false,
      refreshedElsewhere: { since: SINCE, timeoutMs: 12_000 },
      now: () => clock,
      sleep: async (milliseconds) => {
        clock += milliseconds
        // The app's own login shell times out after 5 s and finds nothing.
        if (clock - NOW === 5_000)
          fileShellEnvironmentCache(cacheFile).markRefreshFailed(KEY, clock)
      },
    })
    await started.ready

    expect(probedAt).toEqual([5_000])
    expect(env.PATH).toBe('/probed/bin:/usr/bin:/bin')
  })
})
