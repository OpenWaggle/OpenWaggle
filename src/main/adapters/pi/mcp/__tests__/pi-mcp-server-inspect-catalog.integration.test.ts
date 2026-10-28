import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const userData = vi.hoisted(() => ({ path: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => userData.path },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: {},
}))

const { inspectMcpServer } = await import('../pi-mcp-server-runtime-service')
const { forgetKnownMcpServerStates } = await import('../mcp-server-status-registry')
const { hostMcpToolCatalogStore, mcpToolCatalogKeyOf } = await import('../mcp-tool-catalogs')
const { loadMcpRuntimeConfig } = await import('../../../mcp/config/mcp-runtime-config')
const { deferredMcpVaultSecret, mcpVaultSecretStamps } = await import(
  '../../../mcp/encrypted-mcp-secret-vault-service'
)
const { McpSessionConnectionPool } = await import('../../../mcp/pool/mcp-session-connection-pool')
const { collect, FakeUpstream, flush, INITIALIZE_RESULT, initializeRequest } = await import(
  '../../../mcp/pool/__tests__/fake-upstream'
)

/** A server that now lists the tool `b`. */
const SERVER = `
const readline = require('node:readline')
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n')
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') send({ id: message.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '2' } } })
  if (message.method === 'tools/list') send({ id: message.id, result: { tools: [{ name: 'b', inputSchema: { type: 'object' } }] } })
})
`
const LISTED_B = { tools: [{ name: 'b', inputSchema: { type: 'object' } }] }
const CACHED_A = { tools: [{ name: 'a', inputSchema: { type: 'object' } }] }

let root: string
let roots: { homeDir: string; piAgentDir: string }

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ow-mcp-inspect-catalog-'))
  userData.path = path.join(root, 'user-data')
  roots = { homeDir: path.join(root, 'home'), piAgentDir: path.join(root, 'home', '.pi', 'agent') }
  forgetKnownMcpServerStates()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function configure(server: Record<string, unknown>) {
  const file = path.join(roots.homeDir, '.openwaggle', 'mcp.json')
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ mcpServers: { fixture: server } }))
}

/** The catalog key a Run's Session uses for the server, seeded with the old tool `a`. */
async function seedOldCatalog() {
  const config = await loadMcpRuntimeConfig({
    roots: { ...roots, projectPath: null },
    resolveSecret: deferredMcpVaultSecret,
    secretStamp: mcpVaultSecretStamps(),
  })
  const entry = config.loaded.servers.find((server) => server.name === 'fixture')
  if (!entry) throw new Error('fixture is not configured')
  const key = mcpToolCatalogKeyOf({ entry, config, projectPath: null })
  hostMcpToolCatalogStore.write(key, {
    initialize: INITIALIZE_RESULT,
    toolsPages: { '': CACHED_A },
    savedAt: Date.now(),
  })
  expect(hostMcpToolCatalogStore.read(key)).toBeDefined()
  return key
}

describe('Check connection and the tool catalog (review R5 P2-5)', () => {
  it('makes the next Session list the tools the server offers now', async () => {
    configure({ command: process.execPath, args: ['-e', SERVER] })
    const key = await seedOldCatalog()

    const inspection = await inspectMcpServer({ projectPath: null, name: 'fixture' }, roots)
    expect(inspection).toMatchObject({ state: 'connected', tools: [{ name: 'b' }] })

    const upstreams: InstanceType<typeof FakeUpstream>[] = []
    const pool = new McpSessionConnectionPool({ catalogStore: hostMcpToolCatalogStore })
    const lease = pool.lease('next-session', {
      name: 'fixture',
      fingerprint: 'v1',
      catalogKey: key,
      lazyStart: true,
      open: () => {
        const upstream = new FakeUpstream((request) =>
          request.method === 'tools/list' ? LISTED_B : undefined,
        )
        upstreams.push(upstream)
        return { transport: upstream }
      },
    })
    const client = collect(lease)
    await lease.start()
    await lease.send(initializeRequest(1))
    await lease.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    await lease.send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    await flush()
    await flush()

    expect(upstreams).toHaveLength(1)
    expect(client.messages).toContainEqual({ jsonrpc: '2.0', id: 2, result: LISTED_B })
    await pool.closeAll()
  })

  it('forgets the catalog when the check fails, so the next Session starts the server', async () => {
    configure({ command: process.execPath, args: ['-e', 'process.exit(1)'] })
    const key = await seedOldCatalog()

    const inspection = await inspectMcpServer({ projectPath: null, name: 'fixture' }, roots)

    expect(inspection.state).toBe('failed')
    expect(hostMcpToolCatalogStore.read(key)).toBeUndefined()
  })
})
