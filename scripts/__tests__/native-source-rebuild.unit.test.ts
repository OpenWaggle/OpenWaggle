import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import electronBuilderConfig from '../../electron-builder'
import {
  electronNativeRebuildInvocation,
  nodeNativeRebuildInvocations,
} from '../native-rebuild-invocations'
import { createNativeRebuildPlan } from '../rebuild-native-deps'

describe('native source rebuild', () => {
  it('rebuilds every Node native package from source with its own build command', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-prebuild-only-'))
    try {
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

  it('invalidates the native cache when a patched native source changes', async () => {
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
      const patchPath = path.join(paths.patchesDirectory, 'better-sqlite3@13.0.3.patch')
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
