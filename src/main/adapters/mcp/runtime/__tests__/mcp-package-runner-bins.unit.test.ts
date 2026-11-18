import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveBinFromProbe } from '../mcp-package-runner-bins'
import { parsePackageRunnerCommand } from '../mcp-package-runner-launch'
import { removeScratchDirectories, runnerCache } from './package-runner-fixtures'

afterEach(removeScratchDirectories)

describe('package runner bypass keeps the runtime and flags a bin runs with (review P2-6)', () => {
  it('leaves `bunx --bun` to the runner, which runs even a node bin under Bun', () => {
    expect(parsePackageRunnerCommand('bunx', ['--bun', 'pkg@1.2.3'])).toBeUndefined()
  })

  /** A resolved package whose bin starts with `firstLine`. */
  async function resolvedWith(firstLine: string, file = 'dist/cli.js') {
    const cache = runnerCache('@scope/server', { server: file })
    const script = path.join(path.dirname(cache.binDirectory), '@scope', 'server', file)
    mkdirSync(path.dirname(script), { recursive: true })
    writeFileSync(script, `${firstLine}\nconsole.log(1)\n`)
    chmodSync(script, 0o755)
    const launch = parsePackageRunnerCommand('npx', ['-y', '@scope/server@latest'])
    if (!launch) throw new Error('not a runner launch')
    const resolved = await resolveBinFromProbe(
      { path: cache.binDirectory, node: process.execPath },
      launch,
      1,
    )
    return { resolved, script }
  }

  it('runs a bin whose shebang passes node flags as the file itself, flags included', async () => {
    const { resolved, script } = await resolvedWith(
      '#!/usr/bin/env -S node --experimental-strip-types',
    )
    if (process.platform === 'win32') expect(resolved).toBeUndefined()
    else expect(resolved).toMatchObject({ command: script, prefixArgs: [] })
  })

  it('does not run a `.js` bin whose shebang names another runtime under node', async () => {
    const { resolved } = await resolvedWith('#!/usr/bin/env bun')
    expect(resolved?.command).not.toBe(process.execPath)
  })

  it('still runs a plain node bin with the runner’s node', async () => {
    const { resolved, script } = await resolvedWith('#!/usr/bin/env node')
    expect(resolved).toMatchObject({ command: process.execPath, prefixArgs: [script] })
  })
})
