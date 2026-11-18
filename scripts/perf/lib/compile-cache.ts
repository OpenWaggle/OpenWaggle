import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import type { PerfApp } from './perf-app'
import type { PerfProfile } from './perf-profile'
import { delay, withRunningApp } from './running-app'

/**
 * The V8 compile cache of the boot shim (A-F3) lives under HOME (`~/Library/Caches/OpenWaggle`),
 * and every throwaway profile has its own HOME, so each measured launch starts with a cold cache,
 * as the first launch after an update does. For warm-cache launches, one priming launch per build
 * fills a seed cache that is copied into every measured profile's HOME before it launches. The GUI
 * and the Host both read it, because they share HOME.
 */
export type CompileCacheMode = 'cold' | 'warm'

const CACHE_RELATIVE_PATH = path.join('Library', 'Caches', 'OpenWaggle')
/** The boot shim flushes after ready-to-show and again 1, 3 and 10 s later. */
const PRIMING_SETTLE_MS = 12_000
const PRIMING_TIMEOUT_MS = 120_000

function copyTree(source: string, target: string) {
  execFileSync('cp', ['-c', '-R', `${source}/.`, target], { stdio: 'ignore' })
}

export function compileCacheSeedFor(root: string, app: PerfApp) {
  return path.join(root, `${app.label}-compile-cache`)
}

/** One untimed launch whose compile cache becomes the seed for the build's warm-cache launches. */
export async function primeCompileCache(app: PerfApp, seed: string) {
  await rm(seed, { recursive: true, force: true })
  await mkdir(seed, { recursive: true })
  await withRunningApp(
    app,
    { mode: 'cold', sessionListText: null, timeoutMs: PRIMING_TIMEOUT_MS, warmHostIdleMs: 0 },
    async ({ profile }) => {
      await delay(PRIMING_SETTLE_MS)
      const cache = path.join(profile.home, CACHE_RELATIVE_PATH)
      if (existsSync(cache)) copyTree(cache, seed)
    },
  )
  return existsSync(path.join(seed, 'compile-cache'))
}

/** Copies a primed seed into a fresh profile's HOME. */
export async function seedCompileCache(profile: PerfProfile, seed: string) {
  const cache = path.join(profile.home, CACHE_RELATIVE_PATH)
  await mkdir(cache, { recursive: true })
  copyTree(seed, cache)
}
