import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fauxAssistantMessage, fauxProvider, InMemoryCredentialStore } from '@earendil-works/pi-ai'
import {
  createAgentSession,
  createCodemodeExtension,
  createMcpExtension,
  DefaultResourceLoader,
  type ExtensionAPI,
  type ExtensionUIContext,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadMcpRuntimeConfig } from '../../../mcp/config/mcp-runtime-config'
import { memoryMcpToolCatalogStore } from '../../../mcp/pool/mcp-connection-catalog'
import { mcpServerIdentity } from '../../../mcp/pool/mcp-server-identity'
import { McpSessionConnectionPool } from '../../../mcp/pool/mcp-session-connection-pool'
import { forgetMcpAppTools } from '../mcp-app-registry'
import {
  type CachedMcpAppTools,
  mcpCodemodeReach,
  withDirectKeptWithoutCodemode,
  withKnownMcpAppToolsOf,
  withOpenWaggleMcpExposure,
} from '../mcp-openwaggle-exposure'
import { forgetKnownMcpServerStates } from '../mcp-server-status-registry'
import { openWaggleMcpConnectionHooks } from '../mcp-session-context'
import { cachedMcpAppToolNames } from '../mcp-tool-catalogs'
import { openPiMcpUpstream } from '../pi-mcp-upstream'

/** A stdio MCP server with a plain tool and one that opens an MCP App. */
const SERVER = `
const readline = require('node:readline')
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n')
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') send({ id: message.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } })
  if (message.method === 'tools/list') send({ id: message.id, result: { tools: [
    { name: 'search', description: 'Search', inputSchema: { type: 'object' } },
    { name: 'show', description: 'Show', inputSchema: { type: 'object' }, _meta: { ui: { resourceUri: 'ui://fixture/show' } } },
  ] } })
  if (message.method === 'tools/call') send({ id: message.id, result: { content: [{ type: 'text', text: 'ok' }] } })
})
`

const SESSION_ID = 'exposure-session'
const cleanups: Array<() => Promise<void> | void> = []
let root: string
let roots: { homeDir: string; piAgentDir: string; projectPath: null }

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ow-mcp-exposure-'))
  const homeDir = path.join(root, 'home')
  roots = { homeDir, piAgentDir: path.join(homeDir, '.pi', 'agent'), projectPath: null }
  forgetKnownMcpServerStates()
  forgetMcpAppTools(SESSION_ID)
})

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
  rmSync(root, { recursive: true, force: true })
})

/** The server in Pi's own global file, as a `pi` user configures it: every tool `direct`. */
function configureDirectServer() {
  const file = path.join(roots.piAgentDir, 'mcp.json')
  mkdirSync(path.dirname(file), { recursive: true })
  const config = { command: process.execPath, args: ['-e', SERVER], exposure: 'direct' }
  writeFileSync(file, JSON.stringify({ mcpServers: { fixture: config } }))
  return file
}

async function waitUntil(predicate: () => boolean, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/**
 * Starts a Pi session the way a Run does: OpenWaggle's runtime configuration, Pi's codemode and
 * MCP extensions, and the Session's pooled connection with OpenWaggle's hooks. Returns the tools
 * active when the model was first asked, and the tools active and registered afterwards.
 */
async function runOnce(
  pool: McpSessionConnectionPool,
  options: {
    readonly coldWaitMs?: number
    readonly cached?: CachedMcpAppTools
    /** Pi's `-builtin:codemode`: the codemode extension is not loaded. */
    readonly withoutCodemode?: boolean
  } = {},
) {
  const config = await loadMcpRuntimeConfig({ roots, resolveSecret: async (name) => name })
  const codemode = mcpCodemodeReach(config.loaded.autoEnableCodemode ?? true)
  const fileConfigOf = (name: string) =>
    config.merged.servers.find((server) => server.name === name)?.config
  const directory = mkdtempSync(path.join(root, 'run-'))
  const faux = fauxProvider({ provider: 'exposure-provider', models: [{ id: 'exposure-model' }] })
  let probe: ExtensionAPI | undefined
  let activeAtFirstRequest: string[] = []
  faux.setResponses([
    () => {
      activeAtFirstRequest = probe?.getActiveTools() ?? []
      return fauxAssistantMessage('done')
    },
  ])
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    refreshOnCreate: false,
  })
  modelRuntime.registerNativeProvider(faux.provider)
  await modelRuntime.setRuntimeApiKey(faux.provider.id, 'key')
  const settingsManager = SettingsManager.inMemory({ retry: { enabled: false } })
  const resourceLoader = new DefaultResourceLoader({
    cwd: directory,
    agentDir: directory,
    settingsManager,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [
      ...(options.withoutCodemode ? [] : [createCodemodeExtension()]),
      withOpenWaggleMcpExposure(
        SESSION_ID,
        config.loaded,
        createMcpExtension({
          loadConfig: () =>
            withKnownMcpAppToolsOf(
              SESSION_ID,
              withDirectKeptWithoutCodemode(config.loaded, codemode, fileConfigOf),
              options.cached,
            ),
          createTransport: (entry, cwd) =>
            pool.lease(SESSION_ID, {
              name: entry.name,
              fingerprint: 'v1',
              identity: mcpServerIdentity(entry.name, entry.config),
              catalogKey: entry.name,
              lazyStart: true,
              open: () =>
                openPiMcpUpstream({ entry, transport: 'stdio', cwd, authProvider: undefined }),
            }),
          startupWaitMs: 5_000,
        }),
        options.coldWaitMs === undefined
          ? undefined
          : { waitMs: options.coldWaitMs, ...(options.cached ? { cached: options.cached } : {}) },
        codemode,
      ),
      (pi: ExtensionAPI) => {
        probe = pi
      },
    ],
  })
  await resourceLoader.reload()
  const { session } = await createAgentSession({
    cwd: directory,
    agentDir: directory,
    model: faux.getModel(),
    modelRuntime,
    resourceLoader,
    sessionManager: SessionManager.inMemory(directory),
    settingsManager,
  })
  const notify = vi.fn<ExtensionUIContext['notify']>()
  await session.bindExtensions({ uiContext: fromPartial<ExtensionUIContext>({ notify }) })
  await session.prompt('Hello.')
  const registered = () => probe?.getAllTools().map((tool) => tool.name) ?? []
  await waitUntil(() => registered().includes('mcp__fixture__show'))
  const active = probe?.getActiveTools() ?? []
  const exposures = Object.fromEntries(
    (probe?.getAllTools() ?? []).map((tool) => [tool.name, tool.exposure]),
  )
  await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' })
  session.dispose()
  const notices = notify.mock.calls.map(([message]) => message)
  return { activeAtFirstRequest, active, exposures, notices }
}

describe('MCP exposure as OpenWaggle runs it', () => {
  it("runs a file's direct server as codemode, but declares its MCP App tool", async () => {
    configureDirectServer()
    const pool = new McpSessionConnectionPool({ hooks: openWaggleMcpConnectionHooks })
    cleanups.push(() => pool.closeAll())

    const { active, exposures } = await runOnce(pool)

    // Reached through codemode, which Pi activates for codemode servers.
    expect(active).toContain('codemode')
    expect(active).not.toContain('mcp__fixture__search')
    expect(exposures.mcp__fixture__search).toBe('deferred')
    // The App tool is declared to the model, so the model calls it and the App shows.
    expect(active).toContain('mcp__fixture__show')
    expect(exposures.mcp__fixture__show).toBe('direct')
  }, 60_000)

  it('declares an App tool known from an earlier Run in the first request', async () => {
    const file = configureDirectServer()
    const pool = new McpSessionConnectionPool({ hooks: openWaggleMcpConnectionHooks })
    cleanups.push(() => pool.closeAll())
    await runOnce(pool)

    const { activeAtFirstRequest } = await runOnce(pool)

    expect(activeAtFirstRequest).toContain('mcp__fixture__show')
    expect(activeAtFirstRequest).not.toContain('mcp__fixture__search')
    // Nothing was written: Pi's file still says direct for the `pi` command.
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({
      mcpServers: { fixture: { exposure: 'direct' } },
    })
  }, 60_000)

  it('declares an App tool in the first request of a cold profile’s first Session (C2)', async () => {
    configureDirectServer()
    const pool = new McpSessionConnectionPool({ hooks: openWaggleMcpConnectionHooks })
    cleanups.push(() => pool.closeAll())

    const cold = await runOnce(pool, { coldWaitMs: 5_000 })

    // Nothing knew the server: the first request waited for it, so turn 2 declares the same.
    expect(cold.activeAtFirstRequest).toContain('mcp__fixture__show')
    expect(cold.activeAtFirstRequest).not.toContain('mcp__fixture__search')
  }, 60_000)

  it('declares an App tool from the cached catalog after a Host restart', async () => {
    configureDirectServer()
    const store = memoryMcpToolCatalogStore()
    const cached: CachedMcpAppTools = (entry) => cachedMcpAppToolNames(entry.name, store)
    const first = new McpSessionConnectionPool({
      hooks: openWaggleMcpConnectionHooks,
      catalogStore: store,
    })
    cleanups.push(() => first.closeAll())
    await runOnce(first, { coldWaitMs: 5_000, cached })
    await first.closeAll()
    // A new Host: nothing in memory, only the catalog.
    forgetKnownMcpServerStates()
    forgetMcpAppTools(SESSION_ID)
    const restarted = new McpSessionConnectionPool({
      hooks: openWaggleMcpConnectionHooks,
      catalogStore: store,
    })
    cleanups.push(() => restarted.closeAll())

    expect(cached({ name: 'fixture', config: { command: 'x' }, source: 'x' })).toEqual(['show'])
    const { activeAtFirstRequest } = await runOnce(restarted, { coldWaitMs: 0, cached })

    expect(activeAtFirstRequest).toContain('mcp__fixture__show')
  }, 60_000)
})

describe('MCP exposure in a Run without codemode (review R5 P2-3)', () => {
  it("keeps a file's direct server direct, so its tools stay callable", async () => {
    configureDirectServer()
    const pool = new McpSessionConnectionPool({ hooks: openWaggleMcpConnectionHooks })
    cleanups.push(() => pool.closeAll())

    const { active, exposures, notices } = await runOnce(pool, { withoutCodemode: true })

    expect(active).not.toContain('codemode')
    expect(active).toContain('mcp__fixture__search')
    expect(exposures.mcp__fixture__search).toBe('direct')
    expect(notices.some((notice) => notice.includes('cannot be called'))).toBe(false)
  }, 60_000)
})
