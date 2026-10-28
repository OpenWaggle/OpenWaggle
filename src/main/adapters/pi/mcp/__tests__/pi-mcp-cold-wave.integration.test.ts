import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { McpClient } from '@earendil-works/pi-mcp'
import { afterEach, describe, expect, it } from 'vitest'
import { memoryMcpToolCatalogStore } from '../../../mcp/pool/mcp-connection-catalog'
import { McpSessionConnectionPool } from '../../../mcp/pool/mcp-session-connection-pool'
import { setHostPackageRunnerBypassForTests } from '../../../mcp/runtime/host-package-runner-bypass'
import type { PackageBinStore } from '../../../mcp/runtime/mcp-package-runner-bin-store'
import type { ResolvedPackageBin } from '../../../mcp/runtime/mcp-package-runner-bins'
import { PackageRunnerBypass } from '../../../mcp/runtime/mcp-package-runner-bypass'
import { openPreparedPiMcpUpstream } from '../pi-mcp-upstream'

/** An MCP server that appends `<pid> <ppid>` to a file when it starts. */
const SERVER = `#!/usr/bin/env node
require('node:fs').appendFileSync(process.env.STARTS, process.pid + ' ' + process.ppid + '\\n')
const readline = require('node:readline')
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n')
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') send({ id: message.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } })
  else if (message.method === 'tools/list') send({ id: message.id, result: { tools: [{ name: 'whoami', inputSchema: { type: 'object' } }] } })
  else if (message.method === 'tools/call') send({ id: message.id, result: { content: [{ type: 'text', text: String(process.pid) }] } })
})
`

/** npx stand-in: runs the probe, or stays the parent of the package's bin and says so. */
const FAKE_NPX = `#!/bin/sh
export PATH="$FAKE_NPX_ROOT/node_modules/.bin:$PATH"
if [ "$1" = "--yes" ] || [ "$1" = "-y" ]; then shift; fi
case "$1" in
  --package=*) shift; [ "$1" = "--" ] && shift; "$@"; exit $? ;;
esac
shift
echo wrapper >> "$FAKE_NPX_ROOT/wrapper-launches"
node "$FAKE_NPX_ROOT/node_modules/fixture-mcp/server.js" "$@"
`

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  setHostPackageRunnerBypassForTests(undefined)
})

function memoryStore(): PackageBinStore {
  let saved: Record<string, ResolvedPackageBin> = {}
  return {
    load: () => ({ ...saved }),
    save: (entries) => {
      saved = { ...entries }
    },
  }
}

function lines(file: string) {
  return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean) : []
}

describe.skipIf(process.platform === 'win32')('a cold Hive wave of MCP Sessions', () => {
  it('starts one npx server directly for four new Sessions, and one more per Session that calls it', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'ow-mcp-cold-'))
    cleanups.push(() => rmSync(root, { recursive: true, force: true }))
    const packageDir = path.join(root, 'node_modules', 'fixture-mcp')
    mkdirSync(path.join(root, 'node_modules', '.bin'), { recursive: true })
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({ name: 'fixture-mcp', bin: 'server.js' }),
    )
    writeFileSync(path.join(packageDir, 'server.js'), SERVER)
    const npx = path.join(root, 'npx')
    writeFileSync(npx, FAKE_NPX)
    chmodSync(npx, 0o755)
    // The servers run elsewhere: a package installed in the folder would be left to the runner.
    const cwd = mkdtempSync(path.join(tmpdir(), 'ow-mcp-cold-cwd-'))
    cleanups.push(() => rmSync(cwd, { recursive: true, force: true }))
    setHostPackageRunnerBypassForTests(new PackageRunnerBypass({ store: memoryStore() }))
    const starts = path.join(root, 'starts')
    const entry = {
      name: 'fixture',
      config: {
        command: npx,
        args: ['-y', 'fixture-mcp@latest'],
        env: { FAKE_NPX_ROOT: root, STARTS: starts },
      },
      source: 'test',
    }
    const pool = new McpSessionConnectionPool({ catalogStore: memoryMcpToolCatalogStore() })
    cleanups.push(() => pool.closeAll())
    const spec = {
      name: 'fixture',
      fingerprint: 'v1',
      catalogKey: 'fixture',
      lazyStart: true,
      open: () =>
        openPreparedPiMcpUpstream({ entry, transport: 'stdio', cwd, authProvider: undefined }),
    }
    const connect = async (sessionId: string) => {
      // A Hive's Sessions each have a Run, so none is evicted as least recently used.
      cleanups.push(pool.beginRun(sessionId))
      const client = new McpClient({ name: 'pi', version: '1', requestTimeoutMs: 30_000 })
      await client.connect(pool.lease(sessionId, spec))
      cleanups.push(() => client.close())
      return client
    }

    const clients = await Promise.all(['queen', 'w1', 'w2', 'w3'].map(connect))
    const listed = await Promise.all(clients.map((client) => client.listTools()))

    expect(listed.map((tools) => tools.map((tool) => tool.name))).toEqual(
      Array.from({ length: 4 }, () => ['whoami']),
    )
    expect(lines(starts)).toHaveLength(1)
    // Its parent is the Host itself: no runner process beside it, even on the first spawn.
    expect(lines(starts)[0]?.split(' ')[1]).toBe(String(process.pid))
    expect(lines(path.join(root, 'wrapper-launches'))).toEqual([])

    await clients[2]?.callTool('whoami', {})
    expect(lines(starts)).toHaveLength(2)
  }, 60_000)
})
