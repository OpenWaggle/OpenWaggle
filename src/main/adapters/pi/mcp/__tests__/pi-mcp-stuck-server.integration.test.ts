import { McpClient } from '@earendil-works/pi-mcp'
import { afterEach, describe, expect, it } from 'vitest'
import { McpSessionConnectionPool } from '../../../mcp/pool/mcp-session-connection-pool'
import { openPiMcpUpstream } from '../pi-mcp-upstream'

/**
 * A stdio server that behaves like Datadog's `datadog_mcp_cli` proxy once its own HTTP connection
 * breaks: it lists its tools once, then answers every later request with JSON-RPC "Internal
 * error" for as long as the process lives.
 */
const STUCK_AFTER_FIRST_LISTING = `
const readline = require('node:readline')
let listings = 0
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n')
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id === undefined) return
  if (message.method === 'initialize') {
    send({ id: message.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'stuck', version: '1' } } })
  } else if (message.method === 'tools/list' && listings++ === 0) {
    send({ id: message.id, result: { tools: [{ name: 'whoami', inputSchema: { type: 'object' } }] } })
  } else if (message.method === 'tools/call') {
    send({ id: message.id, result: { content: [{ type: 'text', text: String(process.pid) }] } })
  } else {
    send({ id: message.id, error: { code: -32603, message: 'Internal error' } })
  }
})
`

const pools: McpSessionConnectionPool[] = []

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.closeAll()))
})

function spec() {
  const entry = {
    name: 'datadog',
    config: { command: process.execPath, args: ['-e', STUCK_AFTER_FIRST_LISTING] },
    source: 'test',
  }
  return {
    name: 'datadog',
    fingerprint: 'v1',
    open: () =>
      openPiMcpUpstream({ entry, transport: 'stdio', cwd: process.cwd(), authProvider: undefined }),
  }
}

/** One Run's Pi client: connects over the Session's pooled connection and lists the tools. */
async function run(pool: McpSessionConnectionPool) {
  const client = new McpClient({ name: 'pi', version: '1' })
  await client.connect(pool.lease('session-1', spec()))
  const tools = await client.listTools()
  const result = await client.callTool('whoami', {})
  await client.close()
  const first = result.content[0]
  return { tools: tools.map((tool) => tool.name), pid: first?.type === 'text' ? first.text : '' }
}

describe("A Session's warm MCP connection to a server process that got stuck", () => {
  it('gives the next Run a fresh process instead of the stuck one, without an error', async () => {
    const pool = new McpSessionConnectionPool({})
    pools.push(pool)

    const first = await run(pool)
    const second = await run(pool)

    expect(first.tools).toEqual(['whoami'])
    expect(second.tools).toEqual(['whoami'])
    expect(second.pid).not.toBe(first.pid)
  })
})
