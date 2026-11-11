import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  collectNativeArtifactSignatures,
  removeElectronRebuildMetadata,
  removeNativeBuildDirectories,
} from '../native-rebuild-artifacts'

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value)}\n`, 'utf8')
}

async function writeArtifact(filePath: string, executable = false) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, 'native artifact\n', 'utf8')
  if (executable) await fs.chmod(filePath, 0o755)
}

async function symlinkDirectory(target: string, linkPath: string) {
  await fs.mkdir(path.dirname(linkPath), { recursive: true })
  await fs.symlink(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

describe('native rebuild artifacts', () => {
  it('collects active Bun store artifacts and ignores stale package store entries', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-native-artifacts-'))
    try {
      const storeDirectory = path.join(projectRoot, 'node_modules', '.bun')
      const activeSharpRoot = path.join(storeDirectory, 'sharp@0.34.5', 'node_modules', 'sharp')
      const activeSharpProviderRoot = path.join(
        storeDirectory,
        '@img+sharp-darwin-arm64@0.34.5',
        'node_modules',
        '@img',
        'sharp-darwin-arm64',
      )
      const staleSharpRoot = path.join(storeDirectory, 'sharp@0.32.6', 'node_modules', 'sharp')
      const sqliteRoot = path.join(
        storeDirectory,
        'better-sqlite3@13.0.3',
        'node_modules',
        'better-sqlite3',
      )

      await writeJson(path.join(activeSharpRoot, 'package.json'), {
        name: 'sharp',
        version: '0.34.5',
        optionalDependencies: {
          '@img/sharp-darwin-arm64': '0.34.5',
        },
      })
      await writeJson(path.join(activeSharpProviderRoot, 'package.json'), {
        name: '@img/sharp-darwin-arm64',
        version: '0.34.5',
      })
      await writeArtifact(
        path.join(activeSharpProviderRoot, 'lib', 'sharp-darwin-arm64-0.34.5.node'),
      )
      await writeJson(path.join(staleSharpRoot, 'package.json'), { name: 'sharp' })
      await writeArtifact(path.join(staleSharpRoot, 'build', 'Release', 'sharp-stale.node'))
      await writeJson(path.join(sqliteRoot, 'package.json'), { name: 'better-sqlite3' })
      await writeArtifact(path.join(sqliteRoot, 'build', 'Release', 'better_sqlite3.node'))
      await writeArtifact(path.join(sqliteRoot, 'fixtures', 'unrelated.node'))

      await symlinkDirectory(
        path.relative(path.join(storeDirectory, 'node_modules'), activeSharpRoot),
        path.join(storeDirectory, 'node_modules', 'sharp'),
      )
      await symlinkDirectory(
        path.relative(path.join(storeDirectory, 'node_modules', '@img'), activeSharpProviderRoot),
        path.join(storeDirectory, 'node_modules', '@img', 'sharp-darwin-arm64'),
      )
      await symlinkDirectory(
        path.relative(path.join(projectRoot, 'node_modules'), sqliteRoot),
        path.join(projectRoot, 'node_modules', 'better-sqlite3'),
      )

      const artifacts = await collectNativeArtifactSignatures(
        { projectRoot, storeDirectory },
        ['sharp', 'better-sqlite3'],
        { platform: 'darwin', arch: 'arm64', libc: 'glibc' },
      )

      expect(artifacts).toHaveLength(2)
      expect(artifacts.map((artifact) => artifact.path)).toEqual(
        expect.arrayContaining([
          expect.stringContaining('build/Release/better_sqlite3.node'),
          expect.stringContaining('@img+sharp-darwin-arm64@0.34.5'),
        ]),
      )
      expect(artifacts.map((artifact) => artifact.path).join('\n')).not.toContain('sharp@0.32.6')
      expect(artifacts.map((artifact) => artifact.path).join('\n')).not.toContain('unrelated.node')
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('rejects a random addon when the SQLite addon is missing', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-native-exact-'))
    try {
      const storeDirectory = path.join(projectRoot, 'node_modules', '.bun')
      const sqliteRoot = path.join(
        storeDirectory,
        'better-sqlite3@13.0.3',
        'node_modules',
        'better-sqlite3',
      )
      await writeJson(path.join(sqliteRoot, 'package.json'), { name: 'better-sqlite3' })
      await writeArtifact(path.join(sqliteRoot, 'fixtures', 'better_sqlite3.node'))
      await symlinkDirectory(
        path.relative(path.join(projectRoot, 'node_modules'), sqliteRoot),
        path.join(projectRoot, 'node_modules', 'better-sqlite3'),
      )

      await expect(
        collectNativeArtifactSignatures({ projectRoot, storeDirectory }, ['better-sqlite3'], {
          platform: 'darwin',
          arch: 'arm64',
          libc: 'glibc',
        }),
      ).rejects.toThrow('Missing better-sqlite3')
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('removes Electron rebuild markers from active native package roots only', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-native-metadata-'))
    try {
      const storeDirectory = path.join(projectRoot, 'node_modules', '.bun')
      const activeSqliteRoot = path.join(
        storeDirectory,
        'better-sqlite3@12.10.0',
        'node_modules',
        'better-sqlite3',
      )
      const staleSqliteRoot = path.join(
        storeDirectory,
        'better-sqlite3@11.10.0',
        'node_modules',
        'better-sqlite3',
      )
      const activeMetadataPath = path.join(activeSqliteRoot, 'build', 'Release', '.forge-meta')
      const staleMetadataPath = path.join(staleSqliteRoot, 'build', 'Release', '.forge-meta')

      await writeJson(path.join(activeSqliteRoot, 'package.json'), { name: 'better-sqlite3' })
      await writeArtifact(path.join(activeSqliteRoot, 'build', 'Release', 'better_sqlite3.node'))
      await fs.writeFile(activeMetadataPath, 'arm64--146\n', 'utf8')
      await writeJson(path.join(staleSqliteRoot, 'package.json'), { name: 'better-sqlite3' })
      await writeArtifact(path.join(staleSqliteRoot, 'build', 'Release', 'better_sqlite3.node'))
      await fs.writeFile(staleMetadataPath, 'arm64--146\n', 'utf8')

      await symlinkDirectory(
        path.relative(path.join(projectRoot, 'node_modules'), activeSqliteRoot),
        path.join(projectRoot, 'node_modules', 'better-sqlite3'),
      )

      await removeElectronRebuildMetadata({ projectRoot, storeDirectory }, ['better-sqlite3'])

      expect(await fileExists(activeMetadataPath)).toBe(false)
      expect(await fileExists(staleMetadataPath)).toBe(true)
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('removes active native package build directories without touching stale store entries', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-native-build-dir-'))
    try {
      const storeDirectory = path.join(projectRoot, 'node_modules', '.bun')
      const activeSqliteRoot = path.join(
        storeDirectory,
        'better-sqlite3@12.10.0',
        'node_modules',
        'better-sqlite3',
      )
      const staleSqliteRoot = path.join(
        storeDirectory,
        'better-sqlite3@11.10.0',
        'node_modules',
        'better-sqlite3',
      )
      const activeBuildPath = path.join(activeSqliteRoot, 'build')
      const staleBuildPath = path.join(staleSqliteRoot, 'build')

      await writeJson(path.join(activeSqliteRoot, 'package.json'), { name: 'better-sqlite3' })
      await writeArtifact(path.join(activeBuildPath, 'Release', 'better_sqlite3.node'))
      await writeJson(path.join(staleSqliteRoot, 'package.json'), { name: 'better-sqlite3' })
      await writeArtifact(path.join(staleBuildPath, 'Release', 'better_sqlite3.node'))

      await symlinkDirectory(
        path.relative(path.join(projectRoot, 'node_modules'), activeSqliteRoot),
        path.join(projectRoot, 'node_modules', 'better-sqlite3'),
      )

      await removeNativeBuildDirectories({ projectRoot, storeDirectory }, ['better-sqlite3'])

      expect(await fileExists(activeBuildPath)).toBe(false)
      expect(await fileExists(staleBuildPath)).toBe(true)
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })
})
