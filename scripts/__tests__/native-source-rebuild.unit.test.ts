import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import electronBuilderConfig from '../../electron-builder'
import { collectNativeArtifactSignatures } from '../native-rebuild-artifacts'
import {
  electronNativeRebuildInvocation,
  nodeNativeRebuildInvocations,
} from '../native-rebuild-invocations'
import { createNativeRebuildPlan } from '../rebuild-native-deps'

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
          { projectRoot, storeDirectory: path.join(projectRoot, 'node_modules', '.bun') },
          ['node-pty'],
          { platform: 'darwin', arch: 'arm64', libc: 'glibc' },
        ),
      ).rejects.toThrow('Missing node-pty patched PTY addon')

      await fs.writeFile(
        path.join(nodePtyRoot, 'package.json'),
        `${JSON.stringify({ name: 'node-pty', version: '1.1.0', scripts: { install: 'node scripts/prebuild.js || node-gyp rebuild' } })}\n`,
      )
      const sqliteRoot = path.join(
        projectRoot,
        'node_modules',
        '.bun',
        'node_modules',
        'better-sqlite3',
      )
      await fs.mkdir(sqliteRoot, { recursive: true })
      await fs.writeFile(
        path.join(sqliteRoot, 'package.json'),
        `${JSON.stringify({ name: 'better-sqlite3' })}\n`,
      )
      await fs.writeFile(path.join(sqliteRoot, 'binding.gyp'), '{}\n')

      const invocations = await nodeNativeRebuildInvocations(
        projectRoot,
        { NODE_OPTIONS: '--trace-warnings', PATH: '/usr/bin' },
        '/opt/node/bin/node',
      )
      expect(
        invocations.map(({ packageName, cwd, commandLine }) => ({ packageName, cwd, commandLine })),
      ).toEqual([
        {
          packageName: 'node-pty',
          cwd: await fs.realpath(nodePtyRoot),
          commandLine: 'node scripts/prebuild.js || node-gyp rebuild',
        },
        {
          packageName: 'better-sqlite3',
          cwd: await fs.realpath(sqliteRoot),
          commandLine: 'node-gyp rebuild',
        },
      ])
      expect(invocations[0]?.environment).toMatchObject({
        NODE_OPTIONS: '--trace-warnings --no-deprecation',
        npm_config_build_from_source: 'true',
      })
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true })
    }
  })

  it('makes Electron native rebuilds source-forced', () => {
    expect(
      electronNativeRebuildInvocation({ NODE_OPTIONS: '--trace-warnings' }, '/opt/bun'),
    ).toEqual({
      command: '/opt/bun',
      args: ['x', 'electron-builder', 'install-app-deps'],
      environment: {
        NODE_OPTIONS: '--trace-warnings --no-deprecation',
        npm_config_build_from_source: 'true',
      },
    })
  })

  it('forces electron-builder to rebuild from source for every package target', () => {
    expect(electronBuilderConfig).toEqual(
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
        storeDirectory: path.join(projectRoot, 'node_modules', '.bun'),
      }
      await fs.mkdir(paths.patchesDirectory, { recursive: true })
      await fs.writeFile(path.join(projectRoot, 'package.json'), '{}\n')
      await fs.writeFile(path.join(projectRoot, 'bun.lock'), '{ "lockfileVersion": 1 }\n')
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
