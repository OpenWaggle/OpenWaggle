import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  InMemoryCredentialStore,
} from '@earendil-works/pi-ai'
import {
  createAgentSession,
  createCodemodeExtension,
  createMcpExtension,
  DefaultResourceLoader,
  type ExtensionAPI,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OpenWaggleAuthorizeRequest } from '../../agent-kernel/openwaggle-authorize-channel'

const authorize = vi.hoisted(() =>
  vi.fn<(request: OpenWaggleAuthorizeRequest) => Promise<boolean>>(),
)

// The Run's UI context carries OpenWaggle's authorize channel; this stands in for it.
vi.mock('../../agent-kernel/openwaggle-authorize-channel', () => ({
  getOpenWaggleAuthorize: () => authorize,
}))

import { McpSessionConnectionPool } from '../../../mcp/pool/mcp-session-connection-pool'
import { registerMcpToolApproval } from '../openwaggle-mcp-extensions'
import { openPiMcpUpstream } from '../pi-mcp-upstream'

/** A stdio MCP server with one tool; it counts the calls that reach it. */
const SERVER = `
const readline = require('node:readline')
let calls = 0
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n')
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    send({ id: message.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } })
  } else if (message.method === 'tools/list') {
    send({ id: message.id, result: { tools: [{ name: 'count', inputSchema: { type: 'object' } }] } })
  } else if (message.method === 'tools/call') {
    calls += 1
    send({ id: message.id, result: { content: [{ type: 'text', text: 'calls=' + calls }] } })
  }
})
`

const SCRIPT = 'const result = await tools.mcp__fixture__count({}); text(result.content[0].text)'

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
  authorize.mockReset()
})

async function waitUntil(predicate: () => boolean, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

async function runScript() {
  const directory = mkdtempSync(path.join(tmpdir(), 'ow-mcp-codemode-'))
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  const pool = new McpSessionConnectionPool()
  cleanups.push(() => pool.closeAll())
  const entry = { name: 'fixture', config: { command: process.execPath, args: ['-e', SERVER] } }
  const loaded = {
    servers: [{ ...entry, source: 'test', scope: 'global' as const }],
    errors: [],
  }
  const faux = fauxProvider({ provider: 'codemode-provider', models: [{ id: 'codemode-model' }] })
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('codemode', { code: SCRIPT })),
    fauxAssistantMessage('done'),
  ])
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    refreshOnCreate: false,
  })
  modelRuntime.registerNativeProvider(faux.provider)
  await modelRuntime.setRuntimeApiKey(faux.provider.id, 'key')
  let toolNames: () => string[] = () => []
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
      createCodemodeExtension(),
      createMcpExtension({
        loadConfig: () => loaded,
        createTransport: (piEntry, cwd) =>
          pool.lease('s1', {
            name: piEntry.name,
            fingerprint: 'v1',
            open: () =>
              openPiMcpUpstream({
                entry: piEntry,
                transport: 'stdio',
                cwd,
                authProvider: undefined,
              }),
          }),
        startupWaitMs: 1_500,
      }),
      (pi: ExtensionAPI) => {
        toolNames = () => pi.getAllTools().map((tool) => tool.name)
        registerMcpToolApproval(pi, { loaded })
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
  cleanups.push(() => session.dispose())
  await session.bindExtensions({})
  await waitUntil(() => toolNames().includes('mcp__fixture__count'))
  await session.prompt('Count once.')
  return JSON.stringify(session.messages)
}

describe('an MCP tool a codemode script calls', () => {
  it("asks through OpenWaggle's approval, keyed on the server and the tool, and then runs", async () => {
    authorize.mockResolvedValue(true)

    const transcript = await runScript()

    expect(authorize).toHaveBeenCalledOnce()
    const [request] = authorize.mock.calls[0] ?? []
    expect(request?.message).toContain('(called from a codemode script)')
    expect(request?.scopeKey).toMatchObject({
      capability: 'mcp.tool-call',
      requester: 'fixture',
      resource: 'mcp__fixture__count',
    })
    expect(transcript).toContain('calls=1')
  }, 60_000)

  it('blocks the call when the user declines, so the server never sees it', async () => {
    authorize.mockResolvedValue(false)

    const transcript = await runScript()

    expect(authorize).toHaveBeenCalledOnce()
    expect(transcript).toContain('The user declined this MCP tool call.')
    expect(transcript).not.toContain('calls=1')
  }, 60_000)
})
