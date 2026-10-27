import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PACKAGE_BIN_UNPINNED_TTL_MS,
  type PackageBinStore,
  PackageRunnerBypass,
  type PackageRunnerProbe,
  type ResolvedPackageBin,
} from '../mcp-package-runner-bypass'
import { packageBinPath, parsePackageRunnerCommand } from '../mcp-package-runner-launch'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

/** A runner cache folder holding one package with a JavaScript bin. */
function runnerCache(name = '@scope/server', bin: unknown = { server: 'dist/cli.js' }) {
  const root = mkdtempSync(path.join(tmpdir(), 'ow-npx-'))
  directories.push(root)
  const binDirectory = path.join(root, 'node_modules', '.bin')
  const packageDir = path.join(root, 'node_modules', ...name.split('/'))
  mkdirSync(binDirectory, { recursive: true })
  mkdirSync(path.join(packageDir, 'dist'), { recursive: true })
  writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name, bin }))
  writeFileSync(path.join(packageDir, 'dist', 'cli.js'), '#!/usr/bin/env node\n')
  return { binDirectory, script: path.join(packageDir, 'dist', 'cli.js') }
}

function memoryStore(): PackageBinStore {
  let saved: Record<string, ResolvedPackageBin> = {}
  return {
    load: () => ({ ...saved }),
    save: (entries) => {
      saved = { ...entries }
    },
  }
}

const launchInput = {
  command: 'npx',
  args: ['-y', '@scope/server@latest', '--port', '9'],
  cwd: '/work',
  env: { PATH: '/usr/bin' },
}

describe('package runner parsing (D1.2)', () => {
  it('reads npx, npm exec, pnpm dlx and bunx launches', () => {
    expect(parsePackageRunnerCommand('npx', ['-y', 'figma-developer-mcp', '--stdio'])).toEqual({
      runner: 'npx',
      packageSpec: 'figma-developer-mcp',
      packageName: 'figma-developer-mcp',
      binName: undefined,
      serverArgs: ['--stdio'],
      pinned: false,
    })
    expect(
      parsePackageRunnerCommand('/usr/local/bin/npx', ['mcp-remote@0.1.37', 'https://x']),
    ).toMatchObject({
      packageName: 'mcp-remote',
      pinned: true,
      serverArgs: ['https://x'],
    })
    expect(
      parsePackageRunnerCommand('npm', [
        'exec',
        '--yes',
        '--package=@playwright/mcp@latest',
        '--',
        'mcp-server-playwright',
      ]),
    ).toMatchObject({
      runner: 'npm-exec',
      packageName: '@playwright/mcp',
      binName: 'mcp-server-playwright',
      serverArgs: [],
    })
    expect(parsePackageRunnerCommand('pnpm', ['dlx', 'chrome-devtools-mcp@latest'])).toMatchObject({
      runner: 'pnpm-dlx',
      packageName: 'chrome-devtools-mcp',
    })
    expect(parsePackageRunnerCommand('bunx', ['--bun', 'pkg@1.2.3'])).toMatchObject({
      runner: 'bunx',
      pinned: true,
    })
  })

  it('keeps the runner for forms a direct spawn would not reproduce', () => {
    expect(parsePackageRunnerCommand('node', ['server.js'])).toBeUndefined()
    expect(parsePackageRunnerCommand('npx', ['-p', 'a', '-p', 'b', 'cmd'])).toBeUndefined()
    expect(parsePackageRunnerCommand('npx', ['-c', 'echo hi'])).toBeUndefined()
    expect(parsePackageRunnerCommand('npx', ['github:owner/repo'])).toBeUndefined()
    expect(parsePackageRunnerCommand('npx', ['./local-server'])).toBeUndefined()
    expect(parsePackageRunnerCommand('npx', ['--registry', 'https://r', 'pkg'])).toBeUndefined()
    expect(parsePackageRunnerCommand('npm', ['install', 'pkg'])).toBeUndefined()
    expect(parsePackageRunnerCommand('npx', ['-y'])).toBeUndefined()
  })

  it('picks the bin npm would run', () => {
    expect(packageBinPath({ bin: 'cli.js' }, '@s/tool', undefined)).toBe('cli.js')
    expect(packageBinPath({ bin: { only: 'a.js' } }, 'tool', undefined)).toBe('a.js')
    expect(packageBinPath({ bin: { other: 'a.js', tool: 'b.js' } }, '@s/tool', undefined)).toBe(
      'b.js',
    )
    expect(packageBinPath({ bin: { a: 'a.js', b: 'b.js' } }, 'tool', undefined)).toBeUndefined()
    expect(packageBinPath({ bin: { a: 'a.js', b: 'b.js' } }, 'tool', 'b')).toBe('b.js')
  })
})

describe('package runner bypass (D1.2)', () => {
  it('launches through the runner once, then spawns the resolved bin with the runner’s PATH', async () => {
    const cache = runnerCache()
    const probes: Parameters<PackageRunnerProbe>[0][] = []
    const bypass = new PackageRunnerBypass({
      store: memoryStore(),
      probe: async (input) => {
        probes.push(input)
        return JSON.stringify({
          path: `${cache.binDirectory}${path.delimiter}/usr/bin`,
          node: '/opt/node',
        })
      },
    })

    expect(bypass.launch(launchInput)).toEqual(launchInput)
    await bypass.settled()
    expect(probes).toEqual([
      {
        command: 'npx',
        args: ['--yes', '--package=@scope/server@latest', '--', 'node', '-e', expect.any(String)],
        cwd: '/work',
        env: { PATH: '/usr/bin' },
      },
    ])

    // `/opt/node` does not exist here: a direct launch needs its files, so it stays on the runner.
    expect(bypass.launch(launchInput).command).toBe('npx')
  })

  it('spawns node with the bin script when its files exist, and re-resolves a stale tag', async () => {
    const cache = runnerCache()
    let now = 1_000
    const store = memoryStore()
    const bypass = new PackageRunnerBypass({
      store,
      now: () => now,
      probe: async () => JSON.stringify({ path: cache.binDirectory, node: process.execPath }),
    })
    bypass.launch(launchInput)
    await bypass.settled()

    expect(bypass.launch(launchInput)).toEqual({
      ...launchInput,
      command: process.execPath,
      args: [cache.script, '--port', '9'],
      env: { PATH: `${cache.binDirectory}${path.delimiter}/usr/bin` },
    })
    // A new Host reads the saved resolution.
    const next = new PackageRunnerBypass({ store, now: () => now, probe: async () => '' })
    expect(next.launch(launchInput).command).toBe(process.execPath)

    now += PACKAGE_BIN_UNPINNED_TTL_MS
    expect(bypass.launch(launchInput).command).toBe('npx')
    // Settings' check always uses the runner.
    await bypass.settled()
    expect(bypass.launch(launchInput, { refresh: true }).command).toBe('npx')
  })

  it('keeps the runner when the probe fails or finds no bin', async () => {
    const failures: unknown[] = []
    const bypass = new PackageRunnerBypass({
      store: memoryStore(),
      probe: async () => {
        throw new Error('offline')
      },
      onProbeFailed: (error) => failures.push(error),
    })
    bypass.launch(launchInput)
    await bypass.settled()
    expect(bypass.launch(launchInput).command).toBe('npx')
    expect(failures).toHaveLength(1)

    const cache = runnerCache('@scope/server', { a: 'a.js', b: 'b.js' })
    const ambiguous = new PackageRunnerBypass({
      store: memoryStore(),
      probe: async () => JSON.stringify({ path: cache.binDirectory, node: process.execPath }),
    })
    ambiguous.launch(launchInput)
    await ambiguous.settled()
    expect(ambiguous.launch(launchInput).command).toBe('npx')
  })
})
