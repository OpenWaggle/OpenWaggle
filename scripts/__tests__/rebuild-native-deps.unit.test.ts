import { describe, expect, it } from 'vitest'
import {
  createNativeRebuildCacheKey,
  commandInvocationForPlatform,
  electronRuntimeInstallCommandForPlatform,
  ensureNativeProbeRuntime,
  isNativeRebuildForceEnabled,
  isNativeRebuildMarkerFresh,
  nativeArtifactPackagesForMode,
  nativeLoadProbeCommandForMode,
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

  it('runs native probes from TypeScript without sending source through a shell', () => {
    expect(
      nativeLoadProbeCommandForMode('node', 'C:\\workspace', 'win32', 'C:\\node.exe'),
    ).toMatchObject({
      command: 'C:\\node.exe',
      args: ['--import', 'tsx', 'C:\\workspace\\scripts\\native-load-probe.ts', 'node'],
    })
    expect(
      nativeLoadProbeCommandForMode('electron', 'C:\\workspace', 'win32', 'C:\\node.exe'),
    ).toMatchObject({
      command: 'C:\\workspace\\node_modules\\electron\\dist\\electron.exe',
      args: ['--import', 'tsx', 'C:\\workspace\\scripts\\native-load-probe.ts', 'electron'],
      environment: expect.objectContaining({ ELECTRON_RUN_AS_NODE: '1' }),
    })
  })

  it('installs a missing Electron runtime with Node and no shell wrapper', () => {
    expect(
      electronRuntimeInstallCommandForPlatform('C:\\workspace', 'win32', 'C:\\node.exe'),
    ).toEqual({
      command: 'C:\\node.exe',
      args: ['C:\\workspace\\node_modules\\electron\\install.js'],
    })
  })

  it.each([
    [
      'darwin',
      '/workspace/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
      '/workspace/node_modules/electron/install.js',
    ],
    [
      'linux',
      '/workspace/node_modules/electron/dist/electron',
      '/workspace/node_modules/electron/install.js',
    ],
    [
      'win32',
      'C:\\workspace\\node_modules\\electron\\dist\\electron.exe',
      'C:\\workspace\\node_modules\\electron\\install.js',
    ],
  ] as const)(
    'installs a missing Electron runtime on %s',
    async (platform, expectedExecutable, expectedInstaller) => {
      const projectRoot = platform === 'win32' ? 'C:\\workspace' : '/workspace'
      const accesses: string[] = []
      const invocations: { readonly command: string; readonly args: readonly string[] }[] = []

      await ensureNativeProbeRuntime('electron', {
        projectRoot,
        platform,
        nodeExecutable: platform === 'win32' ? 'C:\\node.exe' : '/usr/bin/node',
        accessPath: async (filePath) => {
          accesses.push(filePath)
          throw new Error('missing')
        },
        runInstall: async (command, args) => {
          invocations.push({ command, args })
        },
      })

      expect(accesses).toEqual([expectedExecutable])
      expect(invocations).toEqual([
        {
          command: platform === 'win32' ? 'C:\\node.exe' : '/usr/bin/node',
          args: [expectedInstaller],
        },
      ])
    },
  )

  it('does not install Electron when its runtime exists or the probe targets Node', async () => {
    const accesses: string[] = []
    const installs: string[] = []
    const options = {
      projectRoot: '/workspace',
      platform: 'linux' as const,
      nodeExecutable: '/usr/bin/node',
      accessPath: async (filePath: string) => {
        accesses.push(filePath)
      },
      runInstall: async (command: string) => {
        installs.push(command)
      },
    }

    await ensureNativeProbeRuntime('electron', options)
    await ensureNativeProbeRuntime('node', options)

    expect(accesses).toEqual(['/workspace/node_modules/electron/dist/electron'])
    expect(installs).toEqual([])
  })

  it('propagates Electron runtime installation failures', async () => {
    await expect(
      ensureNativeProbeRuntime('electron', {
        projectRoot: '/workspace',
        platform: 'linux',
        nodeExecutable: '/usr/bin/node',
        accessPath: async () => {
          throw new Error('missing')
        },
        runInstall: async () => {
          throw new Error('download failed')
        },
      }),
    ).rejects.toThrow('download failed')
  })

  it('invokes Windows command wrappers explicitly without enabling spawn shell parsing', () => {
    expect(
      commandInvocationForPlatform(
        'pnpm',
        ['rebuild', 'better-sqlite3'],
        'win32',
        'C:\\Windows\\System32\\cmd.exe',
      ),
    ).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/c', 'pnpm', 'rebuild', 'better-sqlite3'],
    })
    expect(commandInvocationForPlatform('pnpm', ['rebuild'], 'linux')).toEqual({
      command: 'pnpm',
      args: ['rebuild'],
    })
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
