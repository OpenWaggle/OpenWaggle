import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  type CompileCacheApi,
  type CompileCacheFileSystem,
  enableMainCompileCache,
  flushMainCompileCacheAfterLoad,
  flushMainCompileCacheOnceStarted,
  LONG_LIVED_PROCESS_FLUSH_DELAYS_MS,
  MAIN_COMPILE_CACHE_LATE_FLUSH_DELAYS_MS,
  pruneStaleCompileCaches,
  STALE_COMPILE_CACHE_AGE_MS,
} from '../main-compile-cache'

const STATUS = { ENABLED: 1, ALREADY_ENABLED: 2, FAILED: 0, DISABLED: 3 } as const

function fakeApi(status: number) {
  const enableCompileCache = vi.fn((_directory: string) => ({ status }))
  const flushCompileCache = vi.fn()
  const api: CompileCacheApi = {
    enableCompileCache,
    flushCompileCache,
    constants: { compileCacheStatus: STATUS },
  }
  return { api, enableCompileCache, flushCompileCache }
}

describe('enableMainCompileCache', () => {
  it('enables the cache in the chosen directory', () => {
    const { api, enableCompileCache } = fakeApi(STATUS.ENABLED)

    const cache = enableMainCompileCache({ kind: 'enabled', directory: '/cache/beta' }, api)

    expect(cache.enabled).toBe(true)
    expect(enableCompileCache).toHaveBeenCalledWith('/cache/beta')
  })

  it('never fails startup: a refused, failed or throwing cache is just off', () => {
    expect(
      enableMainCompileCache({ kind: 'enabled', directory: '/c' }, fakeApi(STATUS.FAILED).api)
        .enabled,
    ).toBe(false)
    expect(
      enableMainCompileCache({ kind: 'enabled', directory: '/c' }, fakeApi(STATUS.DISABLED).api)
        .enabled,
    ).toBe(false)
    const throwing = fakeApi(STATUS.ENABLED)
    throwing.enableCompileCache.mockImplementation(() => {
      throw new Error('EACCES')
    })
    expect(enableMainCompileCache({ kind: 'enabled', directory: '/c' }, throwing.api).enabled).toBe(
      false,
    )

    const unwritable = fakeApi(STATUS.ENABLED)
    unwritable.flushCompileCache.mockImplementation(() => {
      throw new Error('ENOSPC')
    })
    expect(() =>
      enableMainCompileCache({ kind: 'enabled', directory: '/c' }, unwritable.api).flush(),
    ).not.toThrow()
  })

  it('does nothing for a disabled location', () => {
    const { api, enableCompileCache } = fakeApi(STATUS.ENABLED)

    expect(enableMainCompileCache({ kind: 'disabled', reason: 'appimage' }, api).enabled).toBe(
      false,
    )
    expect(enableCompileCache).not.toHaveBeenCalled()
  })
})

describe('flushMainCompileCacheAfterLoad', () => {
  it('writes at once, because app.exit() never lets Node write it, and again for files loaded later', () => {
    const { api, flushCompileCache } = fakeApi(STATUS.ENABLED)
    const cache = enableMainCompileCache({ kind: 'enabled', directory: '/c' }, api)
    const unref = vi.fn()
    const scheduled: Array<{ callback: () => void; delayMs: number }> = []

    flushMainCompileCacheAfterLoad(cache, (callback, delayMs) => {
      scheduled.push({ callback, delayMs })
      return { unref }
    })

    expect(flushCompileCache).toHaveBeenCalledTimes(1)
    expect(scheduled.map(({ delayMs }) => delayMs)).toEqual(MAIN_COMPILE_CACHE_LATE_FLUSH_DELAYS_MS)
    // The Host loads lazy externals before it listens; the first rewrite must come soon after.
    expect(scheduled[0]?.delayMs).toBeLessThanOrEqual(1_000)
    expect(unref).toHaveBeenCalledTimes(MAIN_COMPILE_CACHE_LATE_FLUSH_DELAYS_MS.length)
    scheduled[0]?.callback()
    expect(flushCompileCache).toHaveBeenCalledTimes(2)
  })
})

describe('flushMainCompileCacheOnceStarted', () => {
  it("keeps the write off the window's and the Host's startup, then writes for each", () => {
    const { api, flushCompileCache } = fakeApi(STATUS.ENABLED)
    const cache = enableMainCompileCache({ kind: 'enabled', directory: '/c' }, api)
    const scheduled: Array<{ callback: () => void; delayMs: number }> = []

    flushMainCompileCacheOnceStarted(cache, (callback, delayMs) => {
      scheduled.push({ callback, delayMs })
      return {}
    })

    expect(flushCompileCache).not.toHaveBeenCalled()
    expect(scheduled.map(({ delayMs }) => delayMs)).toEqual(LONG_LIVED_PROCESS_FLUSH_DELAYS_MS)
    // A cold Host listens and a cold window shows its shell within about a second.
    expect(Math.min(...LONG_LIVED_PROCESS_FLUSH_DELAYS_MS)).toBeGreaterThanOrEqual(2_000)
    scheduled[0]?.callback()
    expect(flushCompileCache).toHaveBeenCalledOnce()
  })

  it('schedules nothing for a disabled cache', () => {
    const scheduleTimer = vi.fn(() => ({}))

    flushMainCompileCacheOnceStarted({ enabled: false, flush: vi.fn() }, scheduleTimer)

    expect(scheduleTimer).not.toHaveBeenCalled()
  })
})

describe('stale compile cache sweep (R6 P3-11)', () => {
  const DAY_MS = 24 * 60 * 60 * 1_000
  const NOW = Date.UTC(2026, 9, 28)
  const PARENT = path.resolve('/cache/compile-cache/beta')
  const CURRENT = path.join(PARENT, 'v24.22.1-arm64-964aae3f-501')

  /** A cache directory listing: name -> age in days, or 'file'. */
  function fakeFileSystem(entries: Record<string, number | 'file'>) {
    const removed: string[] = []
    const touched: string[] = []
    const fileSystem: CompileCacheFileSystem = {
      readdir: async () => Object.keys(entries),
      stat: async (entry) => {
        const age = entries[path.basename(entry)]
        return { mtimeMs: NOW - (typeof age === 'number' ? age : 0) * DAY_MS, isDirectory: () => age !== 'file' }
      },
      rm: async (entry) => {
        removed.push(entry)
      },
      touch: async (entry) => {
        touched.push(entry)
      },
      realpath: async (entry) => entry,
    }
    return { fileSystem, removed, touched }
  }

  it('removes sibling directories unused for two weeks and keeps its own, recent ones and files', async () => {
    const { fileSystem, removed, touched } = fakeFileSystem({
      'v24.22.1-arm64-964aae3f-501': 30,
      'v22.20.0-arm64-11111111-501': 40,
      'v24.22.1-arm64-22222222-501': 2,
      'notes.txt': 'file',
    })

    await pruneStaleCompileCaches(CURRENT, fileSystem, NOW)

    expect(touched).toEqual([CURRENT])
    expect(removed).toEqual([path.join(PARENT, 'v22.20.0-arm64-11111111-501')])
    expect(STALE_COMPILE_CACHE_AGE_MS).toBe(14 * DAY_MS)
  })

  it('sweeps after the first write of a long-lived process, once, and only below its own directory', async () => {
    const { fileSystem, removed } = fakeFileSystem({ 'v24.22.1-arm64-964aae3f-501': 0, 'v20.0.0-x64-0-501': 90 })
    const { api } = fakeApi(STATUS.ENABLED)
    const withDir = { ...api, getCompileCacheDir: () => CURRENT }
    const cache = enableMainCompileCache({ kind: 'enabled', directory: PARENT }, withDir, fileSystem, () => NOW)
    const scheduled: Array<() => void> = []

    flushMainCompileCacheOnceStarted(cache, (callback) => {
      scheduled.push(callback)
      return {}
    })
    for (const callback of scheduled) callback()
    await vi.waitFor(() => expect(removed).toEqual([path.join(PARENT, 'v20.0.0-x64-0-501')]))

    const foreign = enableMainCompileCache(
      { kind: 'enabled', directory: '/elsewhere' },
      withDir,
      fileSystem,
      () => NOW,
    )
    await foreign.pruneStale?.()
    expect(removed).toHaveLength(1)
  })

  it('never sweeps from a short command', () => {
    const pruneStale = vi.fn(async () => undefined)
    flushMainCompileCacheAfterLoad({ enabled: true, flush: vi.fn(), pruneStale }, () => ({}))
    expect(pruneStale).not.toHaveBeenCalled()
  })
})
