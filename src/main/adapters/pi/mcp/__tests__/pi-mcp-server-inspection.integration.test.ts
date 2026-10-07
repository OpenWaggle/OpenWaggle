import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false }, shell: {} }))

const { inspectMcpServer } = await import('../pi-mcp-server-runtime-service')
const { getMcpServerStatuses } = await import('../pi-mcp-server-status')
const { forgetKnownMcpServerStates } = await import('../mcp-server-status-registry')
const { openWaggleMcpConnectionHooks } = await import('../mcp-session-context')
const { McpSessionConnectionPool } = await import('../../../mcp/pool/mcp-session-connection-pool')
const { mcpServerIdentity } = await import('../../../mcp/pool/mcp-server-identity')
const { FakeUpstream, flush, initializeRequest } = await import(
  '../../../mcp/pool/__tests__/fake-upstream'
)

const SERVER = `
const readline = require('node:readline')
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n')
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') send({ id: message.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } })
  if (message.method === 'tools/list') send({ id: message.id, result: { tools: [
    { name: 'search', description: 'Search', inputSchema: { type: 'object' } },
    { name: 'show', inputSchema: { type: 'object' }, _meta: { ui: { resourceUri: 'ui://fixture/show' } } },
  ] } })
})
`

let root: string
let roots: { homeDir: string; piAgentDir: string }

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ow-mcp-inspect-'))
  roots = { homeDir: path.join(root, 'home'), piAgentDir: path.join(root, 'home', '.pi', 'agent') }
  forgetKnownMcpServerStates()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function configure(servers: Record<string, unknown>) {
  const file = path.join(roots.homeDir, '.openwaggle', 'mcp.json')
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ mcpServers: servers }))
}

describe('MCP server inspection for Settings', () => {
  it('connects, lists tools with their effective exposure and Apps, and disconnects', async () => {
    configure({
      fixture: {
        command: process.execPath,
        args: ['-e', SERVER],
        exposure: 'deferred',
        toolExposure: { show: 'direct' },
      },
    })

    const inspection = await inspectMcpServer({ projectPath: null, name: 'fixture' }, roots)

    expect(inspection).toEqual({
      name: 'fixture',
      state: 'connected',
      tools: [
        { name: 'search', description: 'Search', exposure: 'deferred', hasApp: false },
        { name: 'show', exposure: 'direct', hasApp: true },
      ],
    })
  })

  it('reports a disabled server without starting it, and a failing one with its stderr', async () => {
    configure({
      off: { command: 'never-run', enabled: false },
      broken: {
        command: process.execPath,
        args: ['-e', "console.error('missing API key'); process.exit(1)"],
      },
    })

    const off = await inspectMcpServer({ projectPath: null, name: 'off' }, roots)
    const broken = await inspectMcpServer({ projectPath: null, name: 'broken' }, roots)

    expect(off).toEqual({ name: 'off', state: 'disabled', tools: [] })
    expect(broken).toEqual(
      expect.objectContaining({ name: 'broken', state: 'failed', stderrTail: 'missing API key' }),
    )
  })
})

describe('MCP server inspection when a value cannot be resolved', () => {
  it('reports a missing ${NAME} or vault secret as that server failing, not the whole check', async () => {
    configure({
      env: {
        command: process.execPath,
        args: ['-e', SERVER],
        env: { KEY: '${OW_NOT_SET_ANYWHERE}' },
      },
      vault: {
        url: 'https://v.example/mcp',
        headers: { Authorization: { secret: 'OW_NO_SUCH_SECRET' } },
      },
    })

    const env = await inspectMcpServer({ projectPath: null, name: 'env' }, roots)
    const vault = await inspectMcpServer({ projectPath: null, name: 'vault' }, roots)

    expect(env).toEqual(
      expect.objectContaining({
        name: 'env',
        state: 'failed',
        error: expect.stringContaining('OW_NOT_SET_ANYWHERE'),
      }),
    )
    expect(vault).toEqual(
      expect.objectContaining({
        name: 'vault',
        state: 'failed',
        error: expect.stringContaining('vault secret "OW_NO_SUCH_SECRET"'),
      }),
    )
  })
})

describe('MCP server state for Settings without connecting', () => {
  function pool() {
    return new McpSessionConnectionPool({ hooks: openWaggleMcpConnectionHooks })
  }

  it('starts no server: a server never checked is not checked yet', async () => {
    const started = path.join(root, 'started')
    configure({
      fixture: {
        command: process.execPath,
        args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(started)}, '')`],
      },
      off: { command: 'never-run', enabled: false },
    })

    const statuses = await getMcpServerStatuses({ projectPath: null }, roots, pool())
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(statuses).toEqual([
      { name: 'fixture', source: 'not-checked' },
      { name: 'off', source: 'not-checked' },
    ])
    expect(existsSync(started)).toBe(false)
  })

  it('shows the last check, with exposure from the current configuration', async () => {
    configure({ fixture: { command: process.execPath, args: ['-e', SERVER] } })
    await inspectMcpServer({ projectPath: null, name: 'fixture' }, roots)
    configure({
      fixture: {
        command: process.execPath,
        args: ['-e', SERVER],
        toolExposure: { search: 'hidden' },
      },
    })

    const [status] = await getMcpServerStatuses({ projectPath: null }, roots, pool())

    expect(status).toEqual({
      name: 'fixture',
      source: 'last-check',
      checkedAt: expect.any(Number),
      inspection: {
        name: 'fixture',
        state: 'connected',
        tools: [
          { name: 'search', description: 'Search', exposure: 'hidden', hasApp: false },
          { name: 'show', exposure: 'codemode', hasApp: true },
        ],
      },
    })
  })

  it('shows a Session’s warm connection and the tools its Run listed, sending it nothing', async () => {
    const config = { command: process.execPath, args: ['-e', SERVER] }
    configure({ fixture: config })
    const sessions = pool()
    const upstream = new FakeUpstream((request) =>
      request.method === 'tools/list'
        ? { tools: [{ name: 'search', inputSchema: { type: 'object' } }] }
        : undefined,
    )
    const lease = sessions.lease('run-session', {
      name: 'fixture',
      fingerprint: 'v1',
      identity: mcpServerIdentity('fixture', config),
      open: () => ({ transport: upstream }),
    })
    lease.onMessage(() => {})
    await lease.start()
    await lease.send(initializeRequest(1))
    await lease.send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    await flush()
    const sent = upstream.received.length

    const [status] = await getMcpServerStatuses({ projectPath: null }, roots, sessions)

    expect(status).toEqual({
      name: 'fixture',
      source: 'live',
      inspection: {
        name: 'fixture',
        state: 'connected',
        tools: [{ name: 'search', exposure: 'codemode', hasApp: false }],
      },
    })
    expect(upstream.received).toHaveLength(sent)
  })
})
