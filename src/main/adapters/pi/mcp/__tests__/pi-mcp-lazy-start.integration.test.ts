import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { McpClient } from '@earendil-works/pi-mcp'
import { afterEach, describe, expect, it } from 'vitest'
import { memoryMcpToolCatalogStore } from '../../../mcp/pool/mcp-connection-catalog'
import { McpSessionConnectionPool } from '../../../mcp/pool/mcp-session-connection-pool'
import { openPiMcpUpstream } from '../pi-mcp-upstream'

/** A stdio server that appends its pid to a file when it starts. */
const SERVER = `
require('node:fs').appendFileSync(process.env.MCP_FIXTURE_STARTS, process.pid + '\\n')
const readline = require('node:readline')
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n')
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    send({ id: message.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' }, instructions: 'Fixture tools.' } })
  } else if (message.method === 'tools/list') {
    send({ id: message.id, result: { tools: [{ name: 'whoami', inputSchema: { type: 'object' } }] } })
  } else if (message.method === 'tools/call') {
    send({ id: message.id, result: { content: [{ type: 'text', text: String(process.pid) }] } })
  }
})
`

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function starts(file: string) {
  try {
    return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

describe("Pi's MCP client with cached catalogs (D1.3)", () => {
  it('lists a known server’s tools in a new Session without starting it, and starts it on a call', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'ow-mcp-lazy-'))
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
    const startsFile = path.join(directory, 'starts')
    const pool = new McpSessionConnectionPool({ catalogStore: memoryMcpToolCatalogStore() })
    cleanups.push(() => pool.closeAll())
    const entry = {
      name: 'fixture',
      config: { command: process.execPath, args: ['-e', SERVER], env: { MCP_FIXTURE_STARTS: startsFile } },
      source: 'test',
    }
    const spec = {
      name: 'fixture',
      fingerprint: 'v1',
      catalogKey: 'fixture',
      lazyStart: true,
      open: () =>
        openPiMcpUpstream({ entry, transport: 'stdio', cwd: directory, authProvider: undefined }),
    }
    const connect = async (sessionId: string) => {
      const client = new McpClient({ name: 'pi', version: '1' })
      await client.connect(pool.lease(sessionId, spec))
      cleanups.push(() => client.close())
      return client
    }

    const first = await connect('first')
    expect((await first.listTools()).map((tool) => tool.name)).toEqual(['whoami'])
    expect(starts(startsFile)).toHaveLength(1)

    const second = await connect('second')
    expect(second.instructions).toBe('Fixture tools.')
    expect((await second.listTools()).map((tool) => tool.name)).toEqual(['whoami'])
    // The second Session knows the tools, but has no process yet.
    expect(starts(startsFile)).toHaveLength(1)

    const result = await second.callTool('whoami', {})
    const [content] = result.content
    const pids = starts(startsFile)
    expect(pids).toHaveLength(2)
    // Its own process, not the first Session's (ADR 0013).
    expect(content?.type === 'text' ? content.text : '').toBe(pids[1])
  })
})
