import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { McpClient } from '@earendil-works/pi-mcp'
import { afterEach, describe, expect, it } from 'vitest'
import { McpSessionConnectionPool } from '../../../mcp/pool/mcp-session-connection-pool'
import { openPiMcpUpstream } from '../pi-mcp-upstream'

/** A server that ignores stdin closing and writes its pid to a file. */
const SERVER = `
require('node:fs').writeFileSync(process.env.MCP_FIXTURE_PID_FILE, String(process.pid))
const readline = require('node:readline')
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n')
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    send({ id: message.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } })
  } else if (message.method === 'tools/call') {
    send({ id: message.id, result: { content: [{ type: 'text', text: String(process.pid) }] } })
  }
})
setInterval(() => {}, 1000)
`

/** A launcher that starts the server in its process group and exits at once, as some wrappers do. */
const LAUNCHER = `
require('node:child_process').spawn(process.execPath, ['-e', process.env.MCP_FIXTURE_SERVER], { stdio: 'inherit' })
process.exit(0)
`

const pools: McpSessionConnectionPool[] = []

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.closeAll()))
})

function isRunning(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

describe.skipIf(process.platform === 'win32')('stdio servers in a process group', () => {
  it('stops the server even when the launcher it ran under has already exited', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'ow-mcp-group-'))
    const pidFile = path.join(directory, 'server.pid')
    const pool = new McpSessionConnectionPool()
    pools.push(pool)
    const entry = {
      name: 'fixture',
      config: {
        command: process.execPath,
        args: ['-e', LAUNCHER],
        env: { MCP_FIXTURE_SERVER: SERVER, MCP_FIXTURE_PID_FILE: pidFile },
      },
      source: 'test',
    }
    const client = new McpClient({ name: 'pi', version: '1' })
    try {
      // The launcher's exit ends the connection; the server it started must not outlive it.
      await client
        .connect(
          pool.lease('s1', {
            name: 'fixture',
            fingerprint: 'v1',
            open: () =>
              openPiMcpUpstream({
                entry,
                transport: 'stdio',
                cwd: directory,
                authProvider: undefined,
              }),
          }),
        )
        .catch(() => undefined)
      await waitUntil(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').length > 0)
      const pid = Number(readFileSync(pidFile, 'utf8'))
      await pool.closeSession('s1')

      await waitUntil(() => !isRunning(pid))
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
