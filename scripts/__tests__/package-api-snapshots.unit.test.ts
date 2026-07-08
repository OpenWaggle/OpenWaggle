import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkPackageApiSnapshots,
  createPackageApiSnapshot,
} from '../package-api-snapshots.js'

describe('createPackageApiSnapshot', () => {
  it('renders the typed public exports for one package', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'openwaggle-api-snapshot-'))
    const packageRoot = path.join(projectRoot, 'packages', 'example')
    await mkdir(path.join(packageRoot, 'dist'), { recursive: true })
    await writeFile(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({
        name: '@openwaggle/example',
        exports: {
          '.': {
            types: './dist/index.d.ts',
            import: './dist/index.js',
          },
        },
      }),
    )
    await writeFile(
      path.join(packageRoot, 'dist', 'index.d.ts'),
      ['export interface Example {', '  readonly value: string', '}', ''].join('\n'),
    )

    await expect(createPackageApiSnapshot({ packageRoot, projectRoot })).resolves.toBe(
      [
        '# @openwaggle/example',
        '',
        'Package path: `packages/example`',
        '',
        '## Export `.`',
        '',
        'Types: `dist/index.d.ts`',
        '',
        '### Declarations from `dist/index.d.ts`',
        '',
        '```ts',
        'export interface Example {',
        '  readonly value: string',
        '}',
        '```',
        '',
      ].join('\n'),
    )
  })
})

describe('checkPackageApiSnapshots', () => {
  it('reports drift when a committed baseline is stale', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'openwaggle-api-snapshot-'))
    const packageRoot = path.join(projectRoot, 'packages', 'example')
    const snapshotDir = path.join(projectRoot, 'scripts', 'api-snapshots')
    await mkdir(path.join(packageRoot, 'dist'), { recursive: true })
    await mkdir(snapshotDir, { recursive: true })
    await writeFile(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({
        name: '@openwaggle/example',
        exports: {
          '.': {
            types: './dist/index.d.ts',
            import: './dist/index.js',
          },
        },
      }),
    )
    await writeFile(
      path.join(packageRoot, 'dist', 'index.d.ts'),
      ['export interface Example {', '  readonly current: string', '}', ''].join('\n'),
    )
    await writeFile(
      path.join(snapshotDir, 'example.api.md'),
      ['# @openwaggle/example', '', 'stale baseline', ''].join('\n'),
    )

    await expect(
      checkPackageApiSnapshots({
        packageRoots: [packageRoot],
        projectRoot,
        snapshotDir,
      }),
    ).resolves.toEqual({
      changedSnapshots: ['scripts/api-snapshots/example.api.md'],
      violations: ['scripts/api-snapshots/example.api.md is stale. Run pnpm api:snapshot:update.'],
      writtenSnapshots: [],
    })
  })

  it('writes missing baselines when update mode is enabled', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'openwaggle-api-snapshot-'))
    const packageRoot = path.join(projectRoot, 'packages', 'example')
    const snapshotDir = path.join(projectRoot, 'scripts', 'api-snapshots')
    await mkdir(path.join(packageRoot, 'dist'), { recursive: true })
    await writeFile(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({
        name: '@openwaggle/example',
        exports: {
          '.': {
            types: './dist/index.d.ts',
            import: './dist/index.js',
          },
        },
      }),
    )
    await writeFile(
      path.join(packageRoot, 'dist', 'index.d.ts'),
      ['export declare const current = "value"', ''].join('\n'),
    )

    const result = await checkPackageApiSnapshots({
      packageRoots: [packageRoot],
      projectRoot,
      snapshotDir,
      update: true,
    })

    await expect(readFile(path.join(snapshotDir, 'example.api.md'), 'utf8')).resolves.toContain(
      'export declare const current = "value"',
    )
    expect(result).toEqual({
      changedSnapshots: ['scripts/api-snapshots/example.api.md'],
      violations: [],
      writtenSnapshots: ['scripts/api-snapshots/example.api.md'],
    })
  })

  it('follows relative declaration re-exports', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'openwaggle-api-snapshot-'))
    const packageRoot = path.join(projectRoot, 'packages', 'example')
    await mkdir(path.join(packageRoot, 'dist'), { recursive: true })
    await writeFile(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({
        name: '@openwaggle/example',
        exports: {
          '.': {
            types: './dist/index.d.ts',
            import: './dist/index.js',
          },
        },
      }),
    )
    await writeFile(
      path.join(packageRoot, 'dist', 'index.d.ts'),
      ['export type * from "./internal.js"', ''].join('\n'),
    )
    await writeFile(
      path.join(packageRoot, 'dist', 'internal.d.ts'),
      ['export interface InternalSurface {', '  readonly visible: boolean', '}', ''].join('\n'),
    )

    await expect(createPackageApiSnapshot({ packageRoot, projectRoot })).resolves.toContain(
      [
        '### Declarations from `dist/internal.d.ts`',
        '',
        '```ts',
        'export interface InternalSurface {',
        '  readonly visible: boolean',
        '}',
        '```',
      ].join('\n'),
    )
  })

  it('follows inline relative import type dependencies', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'openwaggle-api-snapshot-'))
    const packageRoot = path.join(projectRoot, 'packages', 'example')
    await mkdir(path.join(packageRoot, 'dist'), { recursive: true })
    await writeFile(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({
        name: '@openwaggle/example',
        exports: {
          '.': {
            types: './dist/index.d.ts',
            import: './dist/index.js',
          },
        },
      }),
    )
    await writeFile(
      path.join(packageRoot, 'dist', 'index.d.ts'),
      [
        'export interface InlineSurface {',
        '  readonly dependency: import("./internal.js").InternalSurface',
        '}',
        '',
      ].join('\n'),
    )
    await writeFile(
      path.join(packageRoot, 'dist', 'internal.d.ts'),
      ['export interface InternalSurface {', '  readonly visible: boolean', '}', ''].join('\n'),
    )

    await expect(createPackageApiSnapshot({ packageRoot, projectRoot })).resolves.toContain(
      [
        '### Declarations from `dist/internal.d.ts`',
        '',
        '```ts',
        'export interface InternalSurface {',
        '  readonly visible: boolean',
        '}',
        '```',
      ].join('\n'),
    )
  })
})
