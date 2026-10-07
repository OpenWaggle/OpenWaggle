/**
 * Runs inside a bundle built with OpenWaggle's Electron main configuration (see
 * `scripts/pi-main-bundle-smoke.ts`). It exercises the Pi 1.0 loaders that only break once Pi is
 * bundled into one main chunk: the codemode sandbox worker and QuickJS wasm, and the MCP
 * extension's lazily loaded runtime with a real stdio server. Pi is imported dynamically because
 * the Pi SDK boundary rule confines static imports to `src/main/adapters/pi/`; the literal
 * specifier is still inlined into the one main chunk.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const MCP_CONNECT_TIMEOUT_MS = 20_000
const MCP_POLL_MS = 50
const SMOKE_TOOL_NAME = 'mcp__smoke__echo'

/** A minimal stdio MCP server: newline-delimited JSON-RPC with one `echo` tool. */
const MCP_SERVER_SOURCE = `
const readline = require('node:readline')
const lines = readline.createInterface({ input: process.stdin })
const reply = (message) => process.stdout.write(JSON.stringify(message) + '\\n')
lines.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id === undefined) return
  const results = {
    initialize: () => ({
      protocolVersion: message.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: 'smoke', version: '1.0.0' },
    }),
    'tools/list': () => ({
      tools: [{
        name: 'echo',
        description: 'Echo text back',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      }],
    }),
    'tools/call': () => ({ content: [{ type: 'text', text: 'echo:' + message.params.arguments.text }] }),
    ping: () => ({}),
  }
  const result = results[message.method]
  if (!result) reply({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } })
  else reply({ jsonrpc: '2.0', id: message.id, result: result() })
})
`

function fail(message: string): never {
  throw new Error(`Pi main bundle smoke: ${message}`)
}

function resultText(result: { readonly content: readonly { readonly type: string }[] }) {
  return result.content
    .map((block) => ('text' in block && typeof block.text === 'string' ? block.text : ''))
    .join('\n')
}

const loadPi = () => import('@earendil-works/pi-coding-agent')
type PiSdk = Awaited<ReturnType<typeof loadPi>>

/** Adds 40 to 1 + 2 + 3 in QuickJS, then calls the MCP tool through codemode's nested tool calls. */
const CODEMODE_SCRIPT = `
const sum = [1, 2, 3].reduce((total, value) => total + value, 40)
const echoed = await tools.${SMOKE_TOOL_NAME}({ text: 'from-codemode' })
return { sum, echoed: echoed.content[0].text }
`

async function waitForTool(names: () => readonly string[], name: string) {
  const deadline = Date.now() + MCP_CONNECT_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (names().includes(name)) return
    await new Promise((resolve) => setTimeout(resolve, MCP_POLL_MS))
  }
  fail(`${name} never registered; tools: ${names().join(', ')}`)
}

async function runBundledSession(pi: PiSdk, workDirectory: string) {
  const serverPath = path.join(workDirectory, 'mcp-smoke-server.cjs')
  await writeFile(serverPath, MCP_SERVER_SOURCE, 'utf8')
  const agentDir = path.join(workDirectory, 'agent')
  const settingsManager = pi.SettingsManager.inMemory()
  const resourceLoader = new pi.DefaultResourceLoader({
    cwd: workDirectory,
    agentDir,
    settingsManager,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [
      {
        name: 'mcp',
        factory: pi.createMcpExtension({
          loadConfig: () => ({
            servers: [
              {
                name: 'smoke',
                source: serverPath,
                scope: 'extension',
                config: { command: process.execPath, args: [serverPath], exposure: 'direct' },
              },
            ],
            errors: [],
          }),
          logPath: path.join(workDirectory, 'mcp.log'),
        }),
      },
      { name: 'codemode', factory: pi.createCodemodeExtension({ models: false }) },
    ],
  })
  await resourceLoader.reload()
  const { session } = await pi.createAgentSession({
    cwd: workDirectory,
    agentDir,
    resourceLoader,
    settingsManager,
    sessionManager: pi.SessionManager.inMemory(workDirectory),
    modelRuntime: await pi.ModelRuntime.create({
      authPath: path.join(agentDir, 'auth.json'),
      modelsPath: path.join(agentDir, 'models.json'),
    }),
  })
  try {
    await session.bindExtensions({})
    await waitForTool(() => session.getAllTools().map((tool) => tool.name), SMOKE_TOOL_NAME)
    session.setActiveToolsByName([...session.getActiveToolNames(), 'codemode', SMOKE_TOOL_NAME])
    const tool = (name: string) => {
      const found = session.agent.state.tools.find((candidate) => candidate.name === name)
      if (!found) fail(`${name} is not an active tool`)
      return found
    }
    const mcp = resultText(await tool(SMOKE_TOOL_NAME).execute('smoke-mcp', { text: 'bundled' }))
    if (!mcp.includes('echo:bundled')) fail(`MCP tool returned ${mcp}`)
    // Nested tool calls are attributed to the assistant message that issued the codemode call.
    session.agent.state.messages = [
      ...session.agent.state.messages,
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'smoke-codemode', name: 'codemode', arguments: { code: CODEMODE_SCRIPT } },
        ],
        api: 'openai-responses',
        provider: 'smoke',
        model: 'smoke',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'toolUse',
        timestamp: Date.now(),
      },
    ]
    const codemode = resultText(await tool('codemode').execute('smoke-codemode', { code: CODEMODE_SCRIPT }))
    if (!codemode.includes('Script completed') || !codemode.includes('46') || !codemode.includes('echo:from-codemode')) {
      fail(`codemode script did not complete: ${codemode}`)
    }
    return { mcp, codemode }
  } finally {
    session.dispose()
  }
}

async function main() {
  const workDirectory = await mkdtemp(path.join(tmpdir(), 'openwaggle-pi-bundle-smoke-'))
  try {
    const { codemode, mcp } = await runBundledSession(await loadPi(), workDirectory)
    process.stdout.write(
      `${JSON.stringify({ ok: true, runtime: process.versions.electron ? 'electron' : 'node', codemode, mcp })}\n`,
    )
  } finally {
    await rm(workDirectory, { recursive: true, force: true })
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
    process.exit(1)
  },
)
