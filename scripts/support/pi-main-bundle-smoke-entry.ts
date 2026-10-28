/**
 * Runs inside a bundle built with OpenWaggle's Electron main configuration (see
 * `scripts/pi-main-bundle-smoke.ts`). It exercises the Pi 1.0 loaders that only break once Pi is
 * bundled into one main chunk: the codemode sandbox worker and QuickJS wasm, and the MCP
 * extension's lazily loaded runtime with a real stdio server. It also loads `@openwaggle/pi-waggle`
 * from the bundle: the package's declared Pi extension entry and the loop, mode-state and protocol
 * modules the desktop Waggle run uses. Pi is imported dynamically because the Pi SDK boundary rule
 * confines static imports to `src/main/adapters/pi/`; the literal specifier is still inlined into
 * the one main chunk.
 */
// Like src/main/index.ts: before any Pi module reads its package.json.
import '../../src/main/apply-pi-package-directory'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { checkBundledOAuthLoaders } from './pi-main-bundle-oauth-smoke'

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

/**
 * The module pi-waggle's declared Pi extension entry (`pi.extensions`, `dist/extension.js`) is built
 * from. The desktop build aliases the package to its sources, so this is `src/extension.ts`; the
 * package consumer smoke checks the built entry.
 */
const loadPiWaggleExtension = () => import('@openwaggle/pi-waggle/extension')
/** The loop the desktop Waggle run imports (`waggle-run.ts`). */
const loadPiWaggleLoop = () => import('@openwaggle/pi-waggle/loop')
const loadPiWaggleModeState = () => import('@openwaggle/pi-waggle/mode-state')
const loadPiWaggleProtocol = () => import('@openwaggle/pi-waggle/protocol')
const loadWaggleCore = () => import('@openwaggle/waggle-core')

interface BundledWaggle {
  readonly extension: Awaited<ReturnType<typeof loadPiWaggleExtension>>
  readonly loop: Awaited<ReturnType<typeof loadPiWaggleLoop>>
  readonly modeState: Awaited<ReturnType<typeof loadPiWaggleModeState>>
  readonly protocol: Awaited<ReturnType<typeof loadPiWaggleProtocol>>
  readonly preset: Awaited<ReturnType<typeof loadWaggleCore>>['BUILT_IN_WAGGLE_PRESETS'][number]
}

async function loadBundledWaggle(): Promise<BundledWaggle> {
  const [extension, loop, modeState, protocol, core] = await Promise.all([
    loadPiWaggleExtension(),
    loadPiWaggleLoop(),
    loadPiWaggleModeState(),
    loadPiWaggleProtocol(),
    loadWaggleCore(),
  ])
  const preset = core.BUILT_IN_WAGGLE_PRESETS[0]
  if (!preset) fail('waggle-core has no built-in Waggle preset')
  return { extension, loop, modeState, protocol, preset }
}

/** The desktop Waggle run's loop, as `waggle-run.ts` builds it, with no turns driven. */
function desktopWaggleLoop(waggle: BundledWaggle) {
  return waggle.loop.createPiWaggleExtension({
    config: waggle.preset.config,
    createTurnMetadata: ({ turnNumber, agentIndex }) => ({ turnNumber, agentIndex }),
    onTurnComplete: () => ({ continue: false }),
    buildTurnMessage: ({ meta }) => ({
      customType: waggle.protocol.PI_WAGGLE_TURN_CUSTOM_TYPE,
      content: `turn ${meta.turnNumber}`,
      display: false,
    }),
  })
}

type DesktopWaggleLoop = ReturnType<typeof desktopWaggleLoop>

/** Lets queued promise callbacks and I/O callbacks run once. */
const nextMacrotask = () => new Promise<void>((resolve) => setImmediate(resolve))

/**
 * A bound loop with no turns is still running, and failing it ends `done` with that error, as the
 * desktop run's turn-start failure path does.
 */
async function checkDesktopWaggleLoop(loop: DesktopWaggleLoop) {
  let settled: 'resolved' | 'rejected' | null = null
  loop.done.then(
    () => {
      settled = 'resolved'
    },
    () => {
      settled = 'rejected'
    },
  )
  await nextMacrotask()
  if (settled !== null) fail(`the desktop Waggle loop ${settled} before any turn ran`)
  const stop = new Error('pi main bundle smoke stopped the loop')
  loop.fail(stop)
  const outcome = await loop.done.then(
    () => fail('the desktop Waggle loop completed instead of failing'),
    (error: unknown) => error,
  )
  if (outcome !== stop) fail(`the desktop Waggle loop failed with ${String(outcome)}`)
  return 'desktop loop bound and stoppable'
}

type BundledSession = Awaited<ReturnType<PiSdk['createAgentSession']>>['session']

/** The declared extension registers Waggle's commands and transcript renderer. */
function checkBundledWaggleExtension(session: BundledSession, waggle: BundledWaggle) {
  const commands = session.extensionRunner.getRegisteredCommands().map((command) => command.name)
  for (const name of ['waggle', 'standard']) {
    if (!commands.includes(name)) fail(`pi-waggle did not register /${name}; commands: ${commands.join(', ')}`)
  }
  if (!session.extensionRunner.getMessageRenderer(waggle.protocol.PI_WAGGLE_TURN_CUSTOM_TYPE)) {
    fail('pi-waggle did not register its turn renderer')
  }
  return 'commands /waggle and /standard, turn renderer'
}

/** The mode-state entry the desktop run writes reads back from the bundled Pi session manager. */
function checkWaggleModeState(session: BundledSession, waggle: BundledWaggle) {
  waggle.modeState.appendPiWaggleModeState(
    session.sessionManager,
    waggle.modeState.enabledPiWaggleModeState({ config: waggle.preset.config, presetId: waggle.preset.id }),
  )
  const state = waggle.modeState.latestPiWaggleModeStateFromBranch(session.sessionManager)
  if (!state?.enabled || state.presetId !== waggle.preset.id) {
    fail(`Waggle mode state did not read back: ${JSON.stringify(state)}`)
  }
  return `mode state ${state.presetId}`
}

/**
 * The desktop loop in a session of its own: OpenWaggle never loads it beside the package's default
 * extension (`pi-waggle-package-dedupe.ts`), whose context handler would run a second loop.
 */
async function runDesktopWaggleLoopSession(pi: PiSdk, waggle: BundledWaggle, workDirectory: string) {
  const loop = desktopWaggleLoop(waggle)
  const agentDir = path.join(workDirectory, 'waggle-agent')
  const settingsManager = pi.SettingsManager.inMemory()
  const resourceLoader = new pi.DefaultResourceLoader({
    cwd: workDirectory,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [{ name: 'pi-waggle-loop', factory: loop.factory }],
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
    // The loop advances on `agent_settled`, so a factory that never ran would leave no handler.
    if (!session.extensionRunner.hasHandlers('agent_settled')) {
      fail('the desktop Waggle loop registered no agent_settled handler')
    }
    return `${checkWaggleModeState(session, waggle)}, ${await checkDesktopWaggleLoop(loop)}`
  } finally {
    session.dispose()
  }
}

/** A 2x2 opaque PNG: `read` returns it as an image block only when Photon (WASM) loads. */
const SMOKE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg=='

/**
 * Adds 40 to 1 + 2 + 3 in QuickJS, calls the MCP tool through codemode's nested tool calls, and
 * shows an image `read` returned, which needs Pi's Photon image pipeline in the bundle.
 */
const codemodeScript = (imagePath: string) => `
const sum = [1, 2, 3].reduce((total, value) => total + value, 40)
const echoed = await tools.${SMOKE_TOOL_NAME}({ text: 'from-codemode' })
image(await tools.read({ path: ${JSON.stringify(imagePath)} }))
return { sum, echoed: echoed.content[0].text }
`

const IMAGE_RESIZE_WORKER_FILE_NAME = 'image-resize-worker.js'

/**
 * Pi falls back to resizing on the calling thread when its worker cannot start, so a read alone
 * cannot tell whether the bundled worker works. Resize the smoke PNG through it directly.
 */
async function resizeThroughImageWorker() {
  const bundleDirectory = path.dirname(process.argv[1] ?? '')
  const worker = new Worker(path.join(bundleDirectory, IMAGE_RESIZE_WORKER_FILE_NAME))
  try {
    const response = await new Promise<unknown>((resolve, reject) => {
      worker.once('message', resolve)
      worker.once('error', reject)
      worker.postMessage({
        inputBytes: new Uint8Array(Buffer.from(SMOKE_PNG_BASE64, 'base64')),
        mimeType: 'image/png',
        options: { maxWidth: 1, maxHeight: 1 },
      })
    })
    const text = JSON.stringify(response)
    if (!text.includes('"width":1') || !text.includes('"originalWidth":2')) {
      fail(`the image resize worker did not resize with Photon: ${text.slice(0, 300)}`)
    }
    return 'resized 2x2 to 1x1'
  } finally {
    await worker.terminate()
  }
}

/**
 * Pi resolves its README, docs (codemode's `codemode.md`), examples, themes, export templates,
 * and its own `VERSION` from its package directory, found by walking up from `import.meta.url`.
 * In the bundle that walk would find OpenWaggle's package.json instead.
 */
function checkPiPackageAssets(pi: PiSdk) {
  const packageDirectory = pi.getPackageDir()
  const manifest: unknown = JSON.parse(readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'))
  const name = typeof manifest === 'object' && manifest !== null && 'name' in manifest ? manifest.name : undefined
  if (name !== '@earendil-works/pi-coding-agent') fail(`Pi's package directory is ${packageDirectory} (${String(name)})`)
  for (const asset of [
    path.join(pi.getDocsPath(), 'codemode.md'),
    pi.getReadmePath(),
    path.join(packageDirectory, 'dist', 'core', 'export-html'),
    path.join(packageDirectory, 'dist', 'modes', 'interactive', 'theme'),
  ]) {
    if (!existsSync(asset)) fail(`Pi asset missing from its package directory: ${asset}`)
  }
  return `${pi.VERSION} at ${packageDirectory}`
}

async function waitForTool(names: () => readonly string[], name: string) {
  const deadline = Date.now() + MCP_CONNECT_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (names().includes(name)) return
    await new Promise((resolve) => setTimeout(resolve, MCP_POLL_MS))
  }
  fail(`${name} never registered; tools: ${names().join(', ')}`)
}

async function runBundledSession(pi: PiSdk, waggle: BundledWaggle, workDirectory: string) {
  const serverPath = path.join(workDirectory, 'mcp-smoke-server.cjs')
  await writeFile(serverPath, MCP_SERVER_SOURCE, 'utf8')
  const imagePath = path.join(workDirectory, 'smoke.png')
  await writeFile(imagePath, Buffer.from(SMOKE_PNG_BASE64, 'base64'))
  const CODEMODE_SCRIPT = codemodeScript(imagePath)
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
      { name: 'pi-waggle', factory: waggle.extension.default },
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
    const waggleCheck = checkBundledWaggleExtension(session, waggle)
    await waitForTool(() => session.getAllTools().map((tool) => tool.name), SMOKE_TOOL_NAME)
    session.setActiveToolsByName([...session.getActiveToolNames(), 'codemode', SMOKE_TOOL_NAME])
    const tool = (name: string) => {
      const found = session.agent.state.tools.find((candidate) => candidate.name === name)
      if (!found) fail(`${name} is not an active tool`)
      return found
    }
    const mcp = resultText(await tool(SMOKE_TOOL_NAME).execute('smoke-mcp', { text: 'bundled' }))
    if (!mcp.includes('echo:bundled')) fail(`MCP tool returned ${mcp}`)
    const read = await tool('read').execute('smoke-read', { path: imagePath })
    if (!read.content.some((block) => block.type === 'image')) {
      fail(`read returned no image block for a PNG: ${resultText(read)}`)
    }
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
    const codemodeResult = await tool('codemode').execute('smoke-codemode', { code: CODEMODE_SCRIPT })
    const codemode = {
      result: resultText(codemodeResult),
      hasImage: codemodeResult.content.some((block) => block.type === 'image'),
    }
    if (
      !codemode.result.includes('Script completed') ||
      !codemode.result.includes('46') ||
      !codemode.result.includes('echo:from-codemode') ||
      !codemode.hasImage
    ) {
      fail(`codemode script did not complete with an image: ${codemode.result}`)
    }
    return { mcp, codemode: codemode.result, waggle: waggleCheck }
  } finally {
    session.dispose()
  }
}

/**
 * Pi writes output files, such as the images codemode scripts show, to `os.tmpdir()`, which reads
 * these variables on every call. Pointing them into the work directory removes the files with it.
 */
async function useTemporaryDirectory(workDirectory: string) {
  const directory = path.join(workDirectory, 'tmp')
  await mkdir(directory)
  for (const name of ['TMPDIR', 'TMP', 'TEMP']) process.env[name] = directory
  return directory
}

async function main() {
  const workDirectory = await mkdtemp(path.join(tmpdir(), 'openwaggle-pi-bundle-smoke-'))
  try {
    const temporaryDirectory = await useTemporaryDirectory(workDirectory)
    // First, before anything else in the bundle could register Pi's OAuth loaders.
    const oauth = await checkBundledOAuthLoaders()
    const pi = await loadPi()
    const packageAssets = checkPiPackageAssets(pi)
    const bundledWaggle = await loadBundledWaggle()
    const { codemode, mcp, waggle: waggleExtension } = await runBundledSession(pi, bundledWaggle, workDirectory)
    const waggle = `${waggleExtension}, ${await runDesktopWaggleLoopSession(pi, bundledWaggle, workDirectory)}`
    const outputFiles = await readdir(temporaryDirectory)
    if (!outputFiles.some((file) => /^pi-codemode-[0-9a-f]+\.png$/.test(file))) {
      fail(`codemode wrote its image outside the smoke's temporary directory: ${outputFiles.join(', ')}`)
    }
    const imageWorker = await resizeThroughImageWorker()
    process.stdout.write(
      `${JSON.stringify({ ok: true, runtime: process.versions.electron ? 'electron' : 'node', codemode, mcp, waggle, imageWorker, packageAssets, oauth })}\n`,
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
