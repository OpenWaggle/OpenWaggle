import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  createAgentSession,
  createMcpExtension,
  DefaultResourceLoader,
  SessionManager,
} from '@earendil-works/pi-coding-agent'
import { McpClient } from '@earendil-works/pi-mcp'
import { afterEach, describe, expect, it } from 'vitest'
import {
  McpSessionConnectionPool,
  type McpSessionConnectionPoolOptions,
} from '../../../mcp/pool/mcp-session-connection-pool'
import { openPiMcpUpstream } from '../pi-mcp-upstream'

/**
 * A stdio MCP server. It ignores stdin closing so only the process-group kill can stop it, and
 * reports its own and its parent's pid so the test can check both are gone.
 */
const SERVER = `
const readline = require('node:readline')
let initializes = 0
let pendingCall
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n')
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    initializes += 1
    send({ id: message.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } })
  } else if (message.method === 'tools/list') {
    send({ id: message.id, result: { tools: [{ name: 'whoami', inputSchema: { type: 'object' } }, { name: 'sample', inputSchema: { type: 'object' } }] } })
  } else if (message.method === 'tools/call' && message.params.name === 'sample') {
    pendingCall = message.id
    send({ id: 'sampling-1', method: 'sampling/createMessage', params: { messages: [], maxTokens: 10 } })
  } else if (message.method === 'tools/call') {
    send({ id: message.id, result: { content: [{ type: 'text', text: JSON.stringify({ pid: process.pid, parent: process.ppid, initializes }) }] } })
  } else if (message.id === 'sampling-1') {
    send({ id: pendingCall, result: { content: [{ type: 'text', text: JSON.stringify(message.result ?? message.error) }] } })
  }
})
setInterval(() => {}, 1000)
`

/** A package runner stand-in: starts the server as its child and waits, as `npx` does. */
const WRAPPER = `
const child = require('node:child_process').spawn(process.execPath, ['-e', process.env.MCP_FIXTURE_SERVER], { stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 0))
setInterval(() => {}, 1000)
`

const pools: McpSessionConnectionPool[] = []

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.closeAll()))
})

function createPool(hooks?: McpSessionConnectionPoolOptions['hooks']) {
  const pool = new McpSessionConnectionPool(hooks ? { hooks } : {})
  pools.push(pool)
  return pool
}

function serverSpec() {
  const entry = {
    name: 'fixture',
    config: {
      command: process.execPath,
      args: ['-e', WRAPPER],
      env: { MCP_FIXTURE_SERVER: SERVER },
    },
    source: 'test',
  }
  return {
    name: 'fixture',
    fingerprint: 'v1',
    open: () =>
      openPiMcpUpstream({ entry, transport: 'stdio', cwd: process.cwd(), authProvider: undefined }),
  }
}

async function connectPiClient(pool: McpSessionConnectionPool, sessionId: string) {
  const client = new McpClient({ name: 'pi', version: '1' })
  await client.connect(pool.lease(sessionId, serverSpec()))
  return client
}

function text(result: Awaited<ReturnType<McpClient['callTool']>>) {
  const first = result.content[0]
  return first?.type === 'text' ? first.text : ''
}

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

describe("Pi's MCP client over OpenWaggle's transport layer", () => {
  it('keeps one server process across Pi clients and answers their initialize from the cache', async () => {
    const pool = createPool()

    const first = await connectPiClient(pool, 's1')
    const before = JSON.parse(text(await first.callTool('whoami', {})))
    await first.close()
    const second = await connectPiClient(pool, 's1')
    const after = JSON.parse(text(await second.callTool('whoami', {})))

    expect(after).toEqual({ ...before, initializes: 1 })
    expect(second.serverInfo).toEqual({ name: 'fixture', version: '1' })
    await second.close()
  })

  it('never shares a server process between two Sessions', async () => {
    const pool = createPool()

    const first = await connectPiClient(pool, 's1')
    const second = await connectPiClient(pool, 's2')
    const one = JSON.parse(text(await first.callTool('whoami', {})))
    const two = JSON.parse(text(await second.callTool('whoami', {})))

    expect(one.pid).not.toBe(two.pid)
    expect([one.initializes, two.initializes]).toEqual([1, 1])
    await pool.closeSession('s1')
    await waitUntil(() => !isRunning(one.pid))
    expect(isRunning(two.pid)).toBe(true)
    await first.close()
    await second.close()
  })

  it('terminates the package runner and the server it started when the Session closes', async () => {
    const pool = createPool()
    const client = await connectPiClient(pool, 's1')
    const { pid, parent } = JSON.parse(text(await client.callTool('whoami', {})))
    expect(isRunning(pid) && isRunning(parent)).toBe(true)

    await pool.closeSession('s1')

    await waitUntil(() => !isRunning(pid) && !isRunning(parent))
  })

  it('answers a sampling request through OpenWaggle while Pi waits for the tool result', async () => {
    const pool = createPool(() => ({
      handleServerRequest: ({ method }) =>
        method === 'sampling/createMessage'
          ? Promise.resolve({ role: 'assistant', content: { type: 'text', text: 'sampled' } })
          : undefined,
    }))
    const client = await connectPiClient(pool, 's1')

    const result = await client.callTool('sample', {})

    expect(JSON.parse(text(result))).toEqual({
      role: 'assistant',
      content: { type: 'text', text: 'sampled' },
    })
    await client.close()
  })
})

describe("Pi's MCP extension in successive sessions of one OpenWaggle Session", () => {
  it('registers the server tools in each Run of the same Session and connects the server once', async () => {
    const agentDir = mkdtempSync(path.join(tmpdir(), 'ow-mcp-agent-'))
    const pool = createPool()
    let opened = 0
    const spec = serverSpec()
    const runOnce = async () => {
      let tools: () => string[] = () => []
      const resourceLoader = new DefaultResourceLoader({
        cwd: agentDir,
        agentDir,
        noSkills: true,
        extensionFactories: [
          createMcpExtension({
            loadConfig: () => ({
              servers: [
                { name: 'fixture', config: { command: 'unused' }, source: 'test', scope: 'global' },
              ],
              errors: [],
            }),
            createTransport: () =>
              pool.lease('s1', {
                ...spec,
                open: () => {
                  opened += 1
                  return spec.open()
                },
              }),
            startupWaitMs: 1_500,
          }),
          (api) => {
            tools = () => api.getAllTools().map((tool) => tool.name)
          },
        ],
      })
      await resourceLoader.reload()
      const { session } = await createAgentSession({
        cwd: agentDir,
        agentDir,
        resourceLoader,
        sessionManager: SessionManager.inMemory(),
      })
      try {
        await session.bindExtensions({})
        await waitUntil(() => tools().includes('mcp__fixture__whoami'))
      } finally {
        session.dispose()
      }
    }

    try {
      await runOnce()
      await runOnce()
    } finally {
      rmSync(agentDir, { recursive: true, force: true })
    }

    expect(opened).toBe(1)
    expect(pool.status('s1')).toEqual([expect.objectContaining({ name: 'fixture' })])
  })
})
