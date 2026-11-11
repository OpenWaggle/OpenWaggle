import { describe, expect, it } from 'vitest'
import {
  createNativeRebuildCacheKey,
  isNativeRebuildForceEnabled,
  isNativeRebuildMarkerFresh,
  NATIVE_ARTIFACT_PACKAGES,
  nativeLoadProbeCommand,
  parseNativeRebuildMarker,
  packageRebuildCommandLine,
  packageRebuildEnvironment,
  parseRebuildOptions,
  shellInvocationForPlatform,
} from '../rebuild-native-deps'

type CacheKeyInput = Parameters<typeof createNativeRebuildCacheKey>[0]
type MarkerFreshInput = Parameters<typeof isNativeRebuildMarkerFresh>

describe('native dependency rebuild cache', () => {
  it('keys the cache by runtime, platform, arch, native state, and script cache version', () => {
    const baseInput = {
      platform: 'darwin',
      arch: 'arm64',
      runtimeVersion: '24.14.0',
      nativeStateHash: 'lock-a',
      cacheVersion: 'strategy-a',
    } satisfies CacheKeyInput

    const baseKey = createNativeRebuildCacheKey(baseInput)

    expect(createNativeRebuildCacheKey({ ...baseInput, runtimeVersion: '24.14.1' })).not.toBe(
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

  it('parses the force option without allowing accidental flags', () => {
    expect(parseRebuildOptions(['bun', 'scripts/rebuild-native-deps.ts'])).toEqual({
      force: false,
    })
    expect(
      parseRebuildOptions(['bun', 'scripts/rebuild-native-deps.ts'], {
        OPENWAGGLE_NATIVE_REBUILD_FORCE: '1',
      }),
    ).toEqual({ force: true })
    expect(parseRebuildOptions(['bun', 'scripts/rebuild-native-deps.ts', '--force'])).toEqual({
      force: true,
    })
    expect(() =>
      parseRebuildOptions(['bun', 'scripts/rebuild-native-deps.ts', 'electron']),
    ).toThrow('Unsupported native rebuild flags')
  })

  it('tracks the native packages that can overwrite artifacts', () => {
    expect(NATIVE_ARTIFACT_PACKAGES).toEqual(['better-sqlite3'])
  })

  it('runs the bundled native probe in Node without sending source through a shell', () => {
    const probe = 'C:\\workspace\\node_modules\\.cache\\openwaggle\\native-load-probe.mjs'
    expect(nativeLoadProbeCommand('C:\\workspace', 'win32', 'C:\\node.exe')).toMatchObject({
      command: 'C:\\node.exe',
      args: [probe, 'C:\\workspace'],
    })
  })

  it('runs a package install step in the platform shell, as package managers run lifecycle scripts', () => {
    expect(
      shellInvocationForPlatform(
        'node scripts/prebuild.js || node-gyp rebuild',
        'win32',
        'C:\\Windows\\System32\\cmd.exe',
      ),
    ).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'node scripts/prebuild.js || node-gyp rebuild'],
    })
    expect(shellInvocationForPlatform('node-gyp rebuild', 'linux')).toEqual({
      command: '/bin/sh',
      args: ['-c', 'node-gyp rebuild'],
    })
  })

  it('rebuilds a package the way npm rebuild does: its install script, else node-gyp', () => {
    expect(
      packageRebuildCommandLine(
        { scripts: { install: 'node scripts/prebuild.js || node-gyp rebuild' } },
        true,
      ),
    ).toBe('node scripts/prebuild.js || node-gyp rebuild')
    expect(
      packageRebuildCommandLine({ scripts: { 'build-release': 'node-gyp rebuild' } }, true),
    ).toBe('node-gyp rebuild')
    expect(packageRebuildCommandLine({ scripts: { install: '  ' } }, false)).toBeNull()
    expect(packageRebuildCommandLine(null, false)).toBeNull()
  })

  it('puts the target Node and the project bin directory first on PATH for a forced source build', () => {
    expect(
      packageRebuildEnvironment(
        '/workspace',
        '/opt/node/bin/node',
        { PATH: '/usr/bin', NODE_OPTIONS: '' },
        'linux',
      ),
    ).toEqual({
      PATH: '/opt/node/bin:/workspace/node_modules/.bin:/usr/bin',
      NODE_OPTIONS: '--no-deprecation',
      npm_config_build_from_source: 'true',
    })
    expect(
      packageRebuildEnvironment(
        'C:\\workspace',
        'C:\\node\\node.exe',
        { Path: 'C:\\Windows' },
        'win32',
      ),
    ).toMatchObject({ Path: 'C:\\node;C:\\workspace\\node_modules\\.bin;C:\\Windows' })
  })

  it('accepts only well-formed cache markers', () => {
    expect(
      parseNativeRebuildMarker({
        cacheVersion: 'strategy-a',
        key: 'node-abc',
        runtimeVersion: '24.14.0',
        nativeStateHash: 'lock-a',
        platform: 'darwin',
        arch: 'arm64',
        artifacts: [
          {
            packageName: 'better-sqlite3',
            path: 'node_modules/.bun/better-sqlite3/build/Release/better_sqlite3.node',
            size: 100,
            mtimeMs: 200,
          },
        ],
      }),
    ).not.toBeNull()

    expect(
      parseNativeRebuildMarker({
        cacheVersion: 'strategy-a',
        key: 'node-abc',
        runtimeVersion: 24,
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
      path: 'node_modules/.bun/better-sqlite3/build/Release/better_sqlite3.node',
      size: 100,
      mtimeMs: 200,
    }
    const plan = {
      cacheVersion: 'strategy-a',
      key: 'node-abc',
      runtimeVersion: '24.14.0',
      nativeStateHash: 'lock-a',
      platform: 'darwin',
      arch: 'arm64',
      artifactPackages: ['better-sqlite3'],
    } satisfies MarkerFreshInput[1]
    const marker = {
      cacheVersion: plan.cacheVersion,
      key: plan.key,
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
    expect(isNativeRebuildMarkerFresh({ ...marker, key: 'node-def' }, plan, [artifact])).toBe(false)
  })
})
