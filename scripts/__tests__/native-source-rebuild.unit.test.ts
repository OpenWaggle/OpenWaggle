import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { collectNativeArtifactSignatures } from '../native-rebuild-artifacts'
import {
  createNativeRebuildPlan,
  electronNativeRebuildInvocation,
  nodeNativeRebuildInvocation,
} from '../rebuild-native-deps'

describe('native source rebuild', () => {
  it('rejects a fresh prebuild-only node-pty package and forces a source rebuild', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-prebuild-only-'))
    try {
      const nodePtyRoot = path.join(projectRoot, 'node_modules', 'node-pty')
      const prebuildRoot = path.join(nodePtyRoot, 'prebuilds', 'darwin-arm64')
      await fs.mkdir(prebuildRoot, { recursive: true })
      await fs.writeFile(
        path.join(nodePtyRoot, 'package.json'),
        `${JSON.stringify({ name: 'node-pty', version: '1.1.0' })}\n`,
      )
      await fs.writeFile(path.join(prebuildRoot, 'pty.node'), 'upstream prebuild')
      await fs.writeFile(path.join(prebuildRoot, 'spawn-helper'), 'upstream helper')

      await expect(
        collectNativeArtifactSignatures(
          { projectRoot, pnpmPackageDirectory: path.join(projectRoot, 'node_modules', '.pnpm') },
          ['node-pty'],
          { platform: 'darwin', arch: 'arm64', libc: 'glibc' },
        ),
      ).rejects.toThrow('Missing node-pty patched PTY addon')

      expect(nodeNativeRebuildInvocation({ NODE_OPTIONS: '--trace-warnings' })).toEqual({
        command: 'pnpm',
        args: ['rebuild', 'node-pty', 'better-sqlite3'],
        environment: {
          NODE_OPTIONS: '--trace-warnings --no-deprecation',
          npm_config_build_from_source: 'true',
        },
      })
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('makes Electron native rebuilds source-forced', () => {
    expect(electronNativeRebuildInvocation({ NODE_OPTIONS: '--trace-warnings' })).toEqual({
      command: 'pnpm',
      args: ['exec', 'electron-builder', 'install-app-deps'],
      environment: {
        NODE_OPTIONS: '--trace-warnings --no-deprecation',
        npm_config_build_from_source: 'true',
      },
    })
  })

  it('forces electron-builder to rebuild from source for every package target', async () => {
    const configuration: unknown = parse(await fs.readFile('electron-builder.yml', 'utf8'))

    expect(configuration).toEqual(
      expect.objectContaining({ buildDependenciesFromSource: true }),
    )
  })

  it('invalidates the native cache when the patched node-pty source changes', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-native-plan-'))
    try {
      const paths = {
        projectRoot,
        electronPackageJsonPath: path.join(projectRoot, 'node_modules', 'electron', 'package.json'),
        cacheDirectory: path.join(projectRoot, 'node_modules', '.cache', 'native-rebuild'),
        patchesDirectory: path.join(projectRoot, 'patches'),
        pnpmPackageDirectory: path.join(projectRoot, 'node_modules', '.pnpm'),
      }
      await fs.mkdir(paths.patchesDirectory, { recursive: true })
      await fs.writeFile(path.join(projectRoot, 'package.json'), '{}\n')
      await fs.writeFile(path.join(projectRoot, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
      const patchPath = path.join(paths.patchesDirectory, 'node-pty@1.1.0.patch')
      await fs.writeFile(patchPath, 'first patch\n')
      const firstPlan = await createNativeRebuildPlan(paths, 'node')

      await fs.writeFile(patchPath, 'second patch\n')
      const secondPlan = await createNativeRebuildPlan(paths, 'node')

      expect(secondPlan.nativeStateHash).not.toBe(firstPlan.nativeStateHash)
      expect(secondPlan.key).not.toBe(firstPlan.key)
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })
})
