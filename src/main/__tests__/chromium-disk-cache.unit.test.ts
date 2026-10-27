import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CHROMIUM_CODE_CACHE_MAX_BYTES,
  CHROMIUM_HTTP_CACHE_MAX_BYTES,
  type ChromiumCacheSession,
  directorySizeBytes,
  limitChromiumHttpDiskCache,
  oversizedChromiumCaches,
  trimChromiumCachesIfOversized,
  watchChromiumCacheSize,
} from '../chromium-disk-cache'

function fakeCommandLine(existing: readonly string[] = []) {
  const switches = new Map<string, string | undefined>(existing.map((name) => [name, '1']))
  return {
    switches,
    commandLine: {
      hasSwitch: (name: string) => switches.has(name),
      appendSwitch: (name: string, value?: string) => {
        switches.set(name, value)
      },
    },
  }
}

function fakeSession(input: {
  readonly httpCacheBytes: number
  readonly persistent?: boolean
  readonly storagePath?: string | null
}) {
  return {
    clearCache: vi.fn(async () => undefined),
    clearCodeCaches: vi.fn(async () => undefined),
    getCacheSize: vi.fn(async () => input.httpCacheBytes),
    isPersistent: () => input.persistent ?? true,
    storagePath:
      input.storagePath === undefined ? '/profile/Partitions/preview' : input.storagePath,
  } satisfies ChromiumCacheSession
}

afterEach(() => {
  vi.useRealTimers()
})

describe('limitChromiumHttpDiskCache', () => {
  it('caps the HTTP disk cache before the app is ready', () => {
    const { commandLine, switches } = fakeCommandLine()
    limitChromiumHttpDiskCache(commandLine)
    expect(switches.get('disk-cache-size')).toBe(String(CHROMIUM_HTTP_CACHE_MAX_BYTES))
  })

  it('keeps a size given on the command line', () => {
    const { commandLine, switches } = fakeCommandLine(['disk-cache-size'])
    limitChromiumHttpDiskCache(commandLine)
    expect(switches.get('disk-cache-size')).toBe('1')
  })
})

describe('oversizedChromiumCaches', () => {
  it('flags each cache only once it is over its bound', () => {
    expect(
      oversizedChromiumCaches({
        httpCacheBytes: CHROMIUM_HTTP_CACHE_MAX_BYTES,
        codeCacheBytes: CHROMIUM_CODE_CACHE_MAX_BYTES,
      }),
    ).toEqual({ httpCache: false, codeCache: false })
    expect(
      oversizedChromiumCaches({
        httpCacheBytes: CHROMIUM_HTTP_CACHE_MAX_BYTES + 1,
        codeCacheBytes: 0,
      }),
    ).toEqual({ httpCache: true, codeCache: false })
    expect(
      oversizedChromiumCaches({
        httpCacheBytes: 0,
        codeCacheBytes: CHROMIUM_CODE_CACHE_MAX_BYTES + 1,
      }),
    ).toEqual({ httpCache: false, codeCache: true })
  })
})

describe('trimChromiumCachesIfOversized', () => {
  it('clears the 853 MB HTTP and 325 MB code cache of a preview partition', async () => {
    const session = fakeSession({ httpCacheBytes: 853_000_000 })
    const measure = vi.fn(async () => 325_000_000)

    const result = await trimChromiumCachesIfOversized(session, measure)

    expect(measure).toHaveBeenCalledWith(path.join('/profile/Partitions/preview', 'Code Cache'))
    expect(session.clearCache).toHaveBeenCalledOnce()
    expect(session.clearCodeCaches).toHaveBeenCalledWith({})
    expect(result).toEqual({
      clearedHttpCacheBytes: 853_000_000,
      clearedCodeCacheBytes: 325_000_000,
    })
  })

  it('leaves caches within their bounds alone', async () => {
    const session = fakeSession({ httpCacheBytes: 10_000_000 })
    const result = await trimChromiumCachesIfOversized(session, async () => 20_000_000)
    expect(session.clearCache).not.toHaveBeenCalled()
    expect(session.clearCodeCaches).not.toHaveBeenCalled()
    expect(result).toEqual({ clearedHttpCacheBytes: 0, clearedCodeCacheBytes: 0 })
  })

  it('does not touch an in-memory session', async () => {
    const session = fakeSession({
      httpCacheBytes: 900_000_000,
      persistent: false,
      storagePath: null,
    })
    const measure = vi.fn(async () => 900_000_000)
    await trimChromiumCachesIfOversized(session, measure)
    expect(session.getCacheSize).not.toHaveBeenCalled()
    expect(measure).not.toHaveBeenCalled()
    expect(session.clearCache).not.toHaveBeenCalled()
  })
})

describe('directorySizeBytes', () => {
  it('adds up nested files and ignores a missing directory', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-cache-size-'))
    try {
      await fs.mkdir(path.join(root, 'js', 'index'), { recursive: true })
      await fs.writeFile(path.join(root, 'js', 'a'), Buffer.alloc(300))
      await fs.writeFile(path.join(root, 'js', 'index', 'b'), Buffer.alloc(700))
      expect(await directorySizeBytes(root)).toBe(1000)
      expect(await directorySizeBytes(path.join(root, 'absent'))).toBe(0)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

describe('watchChromiumCacheSize', () => {
  it('checks after a delay, then periodically, once per session', async () => {
    vi.useFakeTimers()
    const session = fakeSession({ httpCacheBytes: 1 })

    watchChromiumCacheSize(session, { firstCheckDelayMs: 1_000, intervalMs: 10_000 })
    watchChromiumCacheSize(session, { firstCheckDelayMs: 1_000, intervalMs: 10_000 })
    expect(session.getCacheSize).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(session.getCacheSize).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(session.getCacheSize).toHaveBeenCalledTimes(2)
  })
})
