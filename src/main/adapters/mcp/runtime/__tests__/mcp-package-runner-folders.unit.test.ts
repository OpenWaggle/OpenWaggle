import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PackageRunnerBypass } from '../mcp-package-runner-bypass'
import {
  launchInput,
  memoryStore,
  removeScratchDirectories,
  runnerCache,
  scratchDirectory,
} from './package-runner-fixtures'

afterEach(removeScratchDirectories)

describe('package runner bypass and the server folder (review P1-1)', () => {
  /** A folder holding `server/`, a local package, and the runner cache that links it. */
  function folderWithLocalServer() {
    const folder = scratchDirectory('ow-npx-folder-')
    mkdirSync(path.join(folder, 'server'), { recursive: true })
    writeFileSync(
      path.join(folder, 'server', 'package.json'),
      JSON.stringify({ name: 'local-srv', bin: 'index.js' }),
    )
    const cache = runnerCache('local-srv', 'index.js')
    writeFileSync(path.join(path.dirname(cache.binDirectory), 'local-srv', 'index.js'), '')
    return { folder, cache }
  }

  it('never spawns one folder’s `file:` package in another folder', async () => {
    const a = folderWithLocalServer()
    const b = folderWithLocalServer()
    const probed: string[] = []
    const bypass = new PackageRunnerBypass({
      store: memoryStore(),
      probe: async (input) => {
        probed.push(input.cwd)
        const cache = input.cwd === a.folder ? a.cache : b.cache
        return JSON.stringify({ path: cache.binDirectory, node: process.execPath })
      },
    })
    const input = (cwd: string) => ({
      command: 'npx',
      args: ['-y', 'file:./server'],
      cwd,
      env: { PATH: '/usr/bin' },
    })

    await bypass.prepare(input(a.folder), 5_000)
    expect(bypass.launch(input(a.folder)).args[0]).toContain(path.dirname(a.cache.binDirectory))

    // Same spec, same PATH, another folder: its own package, never A's.
    const fromB = bypass.launch(input(b.folder))
    expect(fromB.args.join(' ')).not.toContain(path.dirname(a.cache.binDirectory))
    await bypass.settled()
    expect(probed).toEqual([a.folder, b.folder])
    expect(bypass.launch(input(b.folder)).args[0]).toContain(path.dirname(b.cache.binDirectory))
  })

  it('resolves again in a folder whose `.npmrc` names another registry', async () => {
    const cache = runnerCache()
    const plain = scratchDirectory('ow-npx-plain-')
    const custom = scratchDirectory('ow-npx-npmrc-')
    writeFileSync(path.join(custom, '.npmrc'), 'registry=https://registry.example.test/\n')
    let probes = 0
    const bypass = new PackageRunnerBypass({
      store: memoryStore(),
      probe: async () => {
        probes += 1
        return JSON.stringify({ path: cache.binDirectory, node: process.execPath })
      },
    })
    await bypass.prepare({ ...launchInput, cwd: plain }, 5_000)
    await bypass.prepare({ ...launchInput, cwd: custom }, 5_000)
    expect(probes).toBe(2)
  })
})
