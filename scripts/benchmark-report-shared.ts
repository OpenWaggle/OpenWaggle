export interface PiModel {
  readonly provider: string
  readonly id: string
}

export interface PiSession {
  readonly systemPrompt: string
  readonly messages: readonly unknown[]
  readonly agent: {
    readonly state: {
      readonly tools: ReadonlyArray<{ name: string; description: string; parameters: unknown }>
    }
  }
  prompt(text: string): Promise<void>
  dispose(): void
}

export interface PiServices {
  readonly modelRuntime: {
    getProviders(): ReadonlyArray<{ id: string }>
    getModels(): ReadonlyArray<PiModel>
    getModel(provider: string, id: string): PiModel | undefined
  }
  readonly resourceLoader: {
    getSkills(): { skills: ReadonlyArray<unknown> }
    getAgentsFiles(): { agentsFiles: ReadonlyArray<unknown> }
    getPrompts(): { prompts: ReadonlyArray<unknown> }
    getSystemPrompt(): string | undefined
    getAppendSystemPrompt(): readonly string[]
  }
}

export interface PiSdk {
  createAgentSessionServices(options: { cwd: string; agentDir: string }): Promise<PiServices>
  createAgentSessionFromServices(options: {
    services: PiServices
    sessionManager: unknown
    model?: PiModel
  }): Promise<{ session: PiSession }>
  SessionManager: { inMemory(): unknown }
}

export const CHARS_PER_TOKEN_ESTIMATE = 4

export function estimateTokens(text: string) {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE)
}

export function estimateTokenCount(chars: number) {
  return Math.ceil(chars / CHARS_PER_TOKEN_ESTIMATE)
}

interface ReportTool {
  readonly name: string
  readonly description: string
  readonly parameters: unknown
}

const CHARS_UNIT = 'c'
const TOKENS_UNIT = 't'

export function printRunBanner(agentDir: string, projectDir: string) {
  console.log('OpenWaggle first-turn injection benchmark (bundled Pi SDK)')
  console.log(`agent dir (fresh): ${agentDir}`)
  console.log(`project dir (empty): ${projectDir}`)
  console.log('')
}

export function printLiveTurn(
  turn1: { injected: number; stopReason: string; usage: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number } },
  turn2: { injected: number } | null,
) {
  console.log('')
  console.log('--- live probe (real API call) ---')
  console.log(
    `turn 1 injected tokens (input + cacheRead + cacheWrite): ${turn1.injected} (stopReason=${turn1.stopReason})`,
  )
  console.log(
    `  input=${turn1.usage.input} cacheRead=${turn1.usage.cacheRead} cacheWrite=${turn1.usage.cacheWrite} output=${turn1.usage.output} total=${turn1.usage.totalTokens}`,
  )
  if (turn2) {
    console.log(`turn 2 injected tokens: ${turn2.injected} (delta vs turn 1: ${turn2.injected - turn1.injected})`)
  }
}

export function printResourceDiscovery(input: {
  skills: readonly unknown[]
  agentsFiles: readonly unknown[]
  promptTemplates: readonly unknown[]
  customSystemPrompt: string | undefined
  appendSystemPrompt: readonly string[]
}) {
  console.log('--- resource discovery (should be empty for plain project) ---')
  console.log(`skills loaded: ${input.skills.length}`)
  console.log(`AGENTS.md files loaded: ${input.agentsFiles.length}`)
  console.log(`prompt templates loaded: ${input.promptTemplates.length}`)
  console.log(`custom system prompt: ${input.customSystemPrompt ? 'yes' : 'no'}`)
  console.log(`append system prompt: ${input.appendSystemPrompt.length > 0 ? 'yes' : 'no'}`)
  console.log('')
}

export function printSystemPrompt(systemPrompt: string) {
  console.log('--- system prompt ---')
  console.log(`chars: ${systemPrompt.length}`)
  console.log(`estimated tokens (chars/${CHARS_PER_TOKEN_ESTIMATE}): ${estimateTokens(systemPrompt)}`)
  console.log('')
  console.log(systemPrompt)
  console.log('')
}

export function printToolSchemas(tools: readonly ReportTool[]) {
  console.log('--- tool schemas ---')
  let toolsChars = 0
  for (const tool of tools) {
    const schemaJson = JSON.stringify(tool.parameters) ?? ''
    const toolChars = tool.description.length + schemaJson.length
    toolsChars += toolChars
    console.log(
      `${tool.name}: description=${tool.description.length}${CHARS_UNIT} schema=${schemaJson.length}${CHARS_UNIT} est=~${estimateTokenCount(toolChars)}${TOKENS_UNIT}`,
    )
  }
  console.log(
    `tools total: ${toolsChars}${CHARS_UNIT} est=~${estimateTokenCount(toolsChars)}${TOKENS_UNIT}`,
  )
  console.log('')
  return toolsChars
}
