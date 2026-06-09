import { describe, expect, it } from 'vitest'
import {
  createNativeRebuildCacheKey,
  isNativeRebuildForceEnabled,
  isNativeRebuildMarkerFresh,
  nativeArtifactPackagesForMode,
  parseNativeRebuildMarker,
  parseRebuildOptions,
} from '../rebuild-native-deps'

type CacheKeyInput = Parameters<typeof createNativeRebuildCacheKey>[0]
type MarkerFreshInput = Parameters<typeof isNativeRebuildMarkerFresh>

describe('native dependency rebuild cache', () => {
  it('keys the cache by mode, runtime, platform, arch, native state, and script cache version', () => {
    const baseInput = {
      mode: 'electron',
      platform: 'darwin',
      arch: 'arm64',
      runtimeVersion: '42.3.3',
      nativeStateHash: 'lock-a',
      cacheVersion: 'strategy-a',
    } satisfies CacheKeyInput

    const baseKey = createNativeRebuildCacheKey(baseInput)

    expect(createNativeRebuildCacheKey({ ...baseInput, mode: 'node' })).not.toBe(baseKey)
    expect(createNativeRebuildCacheKey({ ...baseInput, runtimeVersion: '42.3.4' })).not.toBe(
      baseKey,
    )
    expect(createNativeRebuildCacheKey({ ...baseInput, platform: 'linux' })).not.toBe(baseKey)
    expect(createNativeRebuildCacheKey({ ...baseInput, arch: 'x64' })).not.toBe(baseKey)
    expect(createNativeRebuildCacheKey({ ...baseInput, nativeStateHash: 'lock-b' })).not.toBe(
      baseKey,
    )
    expect(createNativeRebuildCacheKey({ ...baseInput, cacheVersion: 'strategy-b' })).not.toBe(
      baseKey,
    )
  })

  it('supports a force flag and env escape hatch', () => {
    expect(isNativeRebuildForceEnabled(['--force'], {})).toBe(true)
    expect(isNativeRebuildForceEnabled([], { OPENWAGGLE_NATIVE_REBUILD_FORCE: 'true' })).toBe(true)
    expect(isNativeRebuildForceEnabled([], { OPENWAGGLE_NATIVE_REBUILD_FORCE: 'yes' })).toBe(true)
    expect(isNativeRebuildForceEnabled([], { OPENWAGGLE_NATIVE_REBUILD_FORCE: '0' })).toBe(false)
  })

  it('parses mode and force options without allowing accidental flags', () => {
    expect(parseRebuildOptions(['tsx', 'scripts/rebuild-native-deps.ts', 'electron'])).toEqual({
      mode: 'electron',
      force: false,
    })
    expect(
      parseRebuildOptions(['tsx', 'scripts/rebuild-native-deps.ts', 'node'], {
        OPENWAGGLE_NATIVE_REBUILD_FORCE: '1',
      }),
    ).toEqual({ mode: 'node', force: true })
    expect(() =>
      parseRebuildOptions(['tsx', 'scripts/rebuild-native-deps.ts', 'electron', '--bad-flag']),
    ).toThrow('Unsupported native rebuild flags')
  })

  it('tracks the native packages that can overwrite artifacts for each ABI mode', () => {
    expect(nativeArtifactPackagesForMode('node')).toEqual(['better-sqlite3'])
    expect(nativeArtifactPackagesForMode('electron')).toEqual([
      'sharp',
      'node-pty',
      'better-sqlite3',
    ])
  })

  it('accepts only well-formed cache markers', () => {
    expect(
      parseNativeRebuildMarker({
        cacheVersion: 'strategy-a',
        key: 'electron-abc',
        mode: 'electron',
        runtimeVersion: '42.3.3',
        nativeStateHash: 'lock-a',
        platform: 'darwin',
        arch: 'arm64',
        artifacts: [
          {
            packageName: 'better-sqlite3',
            path: 'node_modules/.pnpm/better-sqlite3/build/Release/better_sqlite3.node',
            size: 100,
            mtimeMs: 200,
          },
        ],
      }),
    ).not.toBeNull()

    expect(
      parseNativeRebuildMarker({
        cacheVersion: 'strategy-a',
        key: 'electron-abc',
        mode: 'browser',
        runtimeVersion: '42.3.3',
        nativeStateHash: 'lock-a',
        platform: 'darwin',
        arch: 'arm64',
        artifacts: [],
      }),
    ).toBeNull()
  })

  it('invalidates markers when artifact signatures change', () => {
    const artifact = {
      packageName: 'better-sqlite3',
      path: 'node_modules/.pnpm/better-sqlite3/build/Release/better_sqlite3.node',
      size: 100,
      mtimeMs: 200,
    }
    const plan = {
      cacheVersion: 'strategy-a',
      key: 'electron-abc',
      mode: 'electron',
      runtimeVersion: '42.3.3',
      nativeStateHash: 'lock-a',
      platform: 'darwin',
      arch: 'arm64',
      artifactPackages: ['better-sqlite3'],
    } satisfies MarkerFreshInput[1]
    const marker = {
      cacheVersion: plan.cacheVersion,
      key: plan.key,
      mode: plan.mode,
      runtimeVersion: plan.runtimeVersion,
      nativeStateHash: plan.nativeStateHash,
      platform: plan.platform,
      arch: plan.arch,
      artifacts: [artifact],
    } satisfies MarkerFreshInput[0]

    expect(isNativeRebuildMarkerFresh(marker, plan, [artifact])).toBe(true)
    expect(
      isNativeRebuildMarkerFresh(marker, plan, [{ ...artifact, mtimeMs: artifact.mtimeMs + 1 }]),
    ).toBe(false)
    expect(isNativeRebuildMarkerFresh({ ...marker, key: 'electron-def' }, plan, [artifact])).toBe(
      false,
    )
  })
})
