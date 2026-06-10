import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectNativeArtifactSignatures } from '../native-rebuild-artifacts'
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

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value)}\n`, 'utf8')
}

async function writeArtifact(filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, 'native artifact\n', 'utf8')
}

async function symlinkDirectory(target: string, linkPath: string) {
  await fs.mkdir(path.dirname(linkPath), { recursive: true })
  await fs.symlink(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
}

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

  it('collects active pnpm artifacts and ignores stale package store entries', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-native-artifacts-'))
    try {
      const pnpmPackageDirectory = path.join(projectRoot, 'node_modules', '.pnpm')
      const activeSharpRoot = path.join(
        pnpmPackageDirectory,
        'sharp@0.34.5',
        'node_modules',
        'sharp',
      )
      const activeSharpProviderRoot = path.join(
        pnpmPackageDirectory,
        '@img+sharp-darwin-arm64@0.34.5',
        'node_modules',
        '@img',
        'sharp-darwin-arm64',
      )
      const staleSharpRoot = path.join(
        pnpmPackageDirectory,
        'sharp@0.32.6',
        'node_modules',
        'sharp',
      )
      const nodePtyRoot = path.join(
        pnpmPackageDirectory,
        'node-pty@1.1.0',
        'node_modules',
        'node-pty',
      )

      await writeJson(path.join(activeSharpRoot, 'package.json'), {
        name: 'sharp',
        optionalDependencies: {
          '@img/sharp-darwin-arm64': '0.34.5',
        },
      })
      await writeJson(path.join(activeSharpProviderRoot, 'package.json'), {
        name: '@img/sharp-darwin-arm64',
      })
      await writeArtifact(path.join(activeSharpProviderRoot, 'lib', 'sharp-darwin-arm64.node'))
      await writeJson(path.join(staleSharpRoot, 'package.json'), { name: 'sharp' })
      await writeArtifact(path.join(staleSharpRoot, 'build', 'Release', 'sharp-stale.node'))
      await writeJson(path.join(nodePtyRoot, 'package.json'), { name: 'node-pty' })
      await writeArtifact(path.join(nodePtyRoot, 'build', 'Release', 'pty.node'))

      await symlinkDirectory(
        path.relative(path.join(pnpmPackageDirectory, 'node_modules'), activeSharpRoot),
        path.join(pnpmPackageDirectory, 'node_modules', 'sharp'),
      )
      await symlinkDirectory(
        path.relative(
          path.join(pnpmPackageDirectory, 'node_modules', '@img'),
          activeSharpProviderRoot,
        ),
        path.join(pnpmPackageDirectory, 'node_modules', '@img', 'sharp-darwin-arm64'),
      )
      await symlinkDirectory(
        path.relative(path.join(projectRoot, 'node_modules'), nodePtyRoot),
        path.join(projectRoot, 'node_modules', 'node-pty'),
      )

      const artifacts = await collectNativeArtifactSignatures(
        { projectRoot, pnpmPackageDirectory },
        ['sharp', 'node-pty'],
      )

      expect(artifacts).toEqual([
        expect.objectContaining({
          packageName: 'node-pty',
          path: expect.stringContaining('node-pty@1.1.0'),
        }),
        expect.objectContaining({
          packageName: 'sharp',
          path: expect.stringContaining('@img+sharp-darwin-arm64@0.34.5'),
        }),
      ])
      expect(artifacts.map((artifact) => artifact.path).join('\n')).not.toContain(
        'sharp@0.32.6',
      )
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })
})
