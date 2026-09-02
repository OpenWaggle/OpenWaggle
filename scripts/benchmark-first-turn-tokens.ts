import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import {
  estimateTokenCount,
  estimateTokens,
  printLiveTurn,
  printRunBanner,
  printResourceDiscovery,
  printSystemPrompt,
  printToolSchemas,
  type PiModel,
  type PiSdk,
  type PiServices,
  type PiSession,
} from './benchmark-report-shared'

const PROBE_PROMPT = 'Reply with exactly OK and nothing else.'

interface Args {
  live: boolean
  provider: string
  model: string | undefined
  secondTurn: boolean
  keep: boolean
  noSkills: boolean
}

interface UsageSnapshot {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly totalTokens: number
}

interface TurnMeasurement {
  readonly usage: UsageSnapshot
  readonly injected: number
  readonly stopReason: string
}


const ARGV_OFFSET = 2
const ARG_STEP = 1

interface FlagParser {
  readonly flag: string
  readonly apply: (args: Args, argv: readonly string[], index: number) => number
}

const FLAG_PARSERS: readonly FlagParser[] = [
  { flag: '--live', apply: (args) => ((args.live = true), 0) },
  { flag: '--second-turn', apply: (args) => ((args.secondTurn = true), 0) },
  { flag: '--keep', apply: (args) => ((args.keep = true), 0) },
  { flag: '--no-skills', apply: (args) => ((args.noSkills = true), 0) },
  {
    flag: '--provider',
    apply: (args, argv, index) => {
      args.provider = requireValue(argv, index + ARG_STEP, '--provider')
      return ARG_STEP
    },
  },
  {
    flag: '--model',
    apply: (args, argv, index) => {
      args.model = requireValue(argv, index + ARG_STEP, '--model')
      return ARG_STEP
    },
  },
]

function parseArgs(argv: readonly string[]) {
  const args: Args = {
    live: false,
    provider: 'openai-codex',
    model: undefined,
    secondTurn: false,
    keep: false,
    noSkills: false,
  }
  for (let index = 0; index < argv.length; index += ARG_STEP) {
    const flag = argv[index]
    const parser = FLAG_PARSERS.find((candidate) => candidate.flag === flag)
    if (!parser) {
      throw new Error(`Unknown flag: ${flag}`)
    }
    index += parser.apply(args, argv, index)
  }
  return args
}

function requireValue(argv: readonly string[], index: number, flag: string) {
  const value = argv[index]
  if (value === undefined) throw new Error(`Missing value for ${flag}`)
  return value
}

function makeTempDir(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

async function loadPiSdk(): Promise<PiSdk> {
  const repoRoot = path.resolve(import.meta.dirname, '..')
  const distIndex = path.join(
    repoRoot,
    'node_modules',
    '@earendil-works',
    'pi-coding-agent',
    'dist',
    'index.js',
  )
  if (!fs.existsSync(distIndex)) {
    throw new Error(`Pi SDK not found at ${distIndex}. Run pnpm install first.`)
  }
  const sdk: unknown = await import(pathToFileURL(distIndex).href)
  return createPiSdk(sdk)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isPiSdk(value: unknown): value is PiSdk {
  return (
    isRecord(value) &&
    typeof value.createAgentSessionServices === 'function' &&
    typeof value.createAgentSessionFromServices === 'function' &&
    typeof value.SessionManager === 'function'
  )
}

function createPiSdk(value: unknown): PiSdk {
  if (!isPiSdk(value)) {
    throw new Error('Pi SDK entry point is missing expected exports')
  }
  return value
}

function getAssistantUsage(messages: readonly unknown[]): UsageSnapshot | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!isRecord(message) || message.role !== 'assistant') {
      continue
    }
    const usage = message.usage
    if (!isRecord(usage)) {
      continue
    }
    const record = usage
    const input = typeof record.input === 'number' ? record.input : 0
    const output = typeof record.output === 'number' ? record.output : 0
    const cacheRead = typeof record.cacheRead === 'number' ? record.cacheRead : 0
    const cacheWrite = typeof record.cacheWrite === 'number' ? record.cacheWrite : 0
    const totalTokens =
      typeof record.totalTokens === 'number'
        ? record.totalTokens
        : input + output + cacheRead + cacheWrite
    return { input, output, cacheRead, cacheWrite, totalTokens }
  }
  return null
}

function copyAuthIntoAgentDir(agentDir: string) {
  const sourceAuth = path.join(os.homedir(), '.pi', 'agent', 'auth.json')
  if (!fs.existsSync(sourceAuth)) {
    throw new Error(`No credentials found at ${sourceAuth}`)
  }
  fs.copyFileSync(sourceAuth, path.join(agentDir, 'auth.json'))
  for (const name of ['models-store.json', 'models.json']) {
    const source = path.join(os.homedir(), '.pi', 'agent', name)
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, path.join(agentDir, name))
    }
  }
}

function removeAuthCopy(agentDir: string) {
  fs.rmSync(path.join(agentDir, 'auth.json'), { force: true })
}

async function promptAndMeasure(session: PiSession) {
  await session.prompt(PROBE_PROMPT)
  const usage = getAssistantUsage(session.messages)
  if (!usage) {
    throw new Error('No assistant usage found after prompt')
  }
  const last = session.messages[session.messages.length - 1]
  return {
    usage,
    injected: usage.input + usage.cacheRead + usage.cacheWrite,
    stopReason:
      isRecord(last) && typeof last.stopReason === 'string' ? last.stopReason : 'unknown',
  }
}

function pickModel(services: PiServices, providerId: string, modelId: string | undefined): PiModel {
  if (modelId !== undefined) {
    const model = services.modelRuntime.getModel(providerId, modelId)
    if (!model) {
      throw new Error(`Unknown model: ${providerId}/${modelId}`)
    }
    return model
  }
  const providerIds = new Set(services.modelRuntime.getProviders().map((provider) => provider.id))
  if (providerIds.has(providerId)) {
    const available = services.modelRuntime
      .getModels()
      .filter((model) => model.provider === providerId)
    const preferred =
      available.find((model) => model.id === 'gpt-5.1-codex') ??
      available.find((model) => model.id.includes('codex')) ??
      available[0]
    if (preferred) {
      return preferred
    }
  }
  const fallback = services.modelRuntime.getModels()[0]
  if (!fallback) {
    throw new Error('No models available in the runtime catalog')
  }
  console.log(
    `[model] provider "${providerId}" not found; using ${fallback.provider}/${fallback.id}`,
  )
  return fallback
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(ARGV_OFFSET))

  const agentDir = makeTempDir('openwaggle-bench-agent-')
  const projectDir = makeTempDir('openwaggle-bench-project-')
  process.env.PI_CODING_AGENT_DIR = agentDir
  if (!args.live) {
    process.env.PI_OFFLINE = '1'
  }
  if (args.live || args.model !== undefined) {
    copyAuthIntoAgentDir(agentDir)
  }

  try {
    const pi = await loadPiSdk()

    printRunBanner(agentDir, projectDir)

    const services = await pi.createAgentSessionServices({
      cwd: projectDir,
      agentDir,
      ...(args.noSkills
        ? { resourceLoaderOptions: { noSkills: true, noPromptTemplates: true, noThemes: true } }
        : {}),
    })

    const skills = services.resourceLoader.getSkills().skills
    const agentsFiles = services.resourceLoader.getAgentsFiles().agentsFiles
    const promptTemplates = services.resourceLoader.getPrompts().prompts
    const customSystemPrompt = services.resourceLoader.getSystemPrompt()
    const appendSystemPrompt = services.resourceLoader.getAppendSystemPrompt()

    printResourceDiscovery({
      skills,
      agentsFiles,
      promptTemplates,
      customSystemPrompt,
      appendSystemPrompt,
    })

    const model = pickModel(services, args.provider, args.model)
    console.log(`model: ${model.provider}/${model.id}`)
    console.log('')

    const sessionResult = await pi.createAgentSessionFromServices({
      services,
      sessionManager: pi.SessionManager.inMemory(),
      model,
    })
    const session = sessionResult.session

    const systemPrompt = session.systemPrompt
    const tools = session.agent.state.tools

    printSystemPrompt(systemPrompt)
    const toolsChars = printToolSchemas(tools)

    const offlineTotal = estimateTokens(systemPrompt) + estimateTokenCount(toolsChars)
    console.log(`OFFLINE ESTIMATE (system prompt + tool schemas): ~${offlineTotal} tokens`)

    if (args.live) {
      const turn1 = await promptAndMeasure(session)
      printLiveTurn(turn1, args.secondTurn ? await promptAndMeasure(session) : null)
    }

    session.dispose()
  } finally {
    if (!args.keep) {
      fs.rmSync(agentDir, { recursive: true, force: true })
      fs.rmSync(projectDir, { recursive: true, force: true })
    } else {
      // The kept agent dir holds a copy of your real auth.json; clean up
      // manually when done inspecting.
      removeAuthCopy(agentDir)
      console.log(`[kept] ${agentDir}`)
      console.log(`[kept] ${projectDir}`)
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})