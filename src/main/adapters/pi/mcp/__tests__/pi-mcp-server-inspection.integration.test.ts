import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false }, shell: {} }))

const { inspectMcpServer } = await import('../pi-mcp-server-runtime-service')

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
