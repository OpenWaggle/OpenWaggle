import { Tiktoken } from 'js-tiktoken/lite'
import o200kBase from 'js-tiktoken/ranks/o200k_base'

/**
 * Opus 5.x bills about 1.667 tokens for every o200k token of OpenWaggle prompt text. Calibrated in
 * the v1 performance research against 17 recorded Bedrock requests (range 1.657–1.681).
 */
export const OPUS_TOKENS_PER_O200K_TOKEN = 1.667

/** One tool declaration as a provider receives it. */
export interface PrefixTool {
  readonly name: string
  readonly description: string
  readonly parameters: unknown
}

/** The fixed part of a first model request: what every call of a Run pays before any history. */
export interface PrefixContent {
  /** The leading system prompt, split into named sections (Pi records `sections`). */
  readonly sections: readonly { readonly name: string; readonly text: string }[]
  readonly tools: readonly PrefixTool[]
  /** Hidden per-Run messages that precede the user prompt, such as the Run identity. */
  readonly runContext: readonly string[]
}

export interface PrefixPartTokens {
  readonly name: string
  readonly chars: number
  readonly o200k: number
}

export interface PrefixTokenReport {
  readonly o200kTotal: number
  readonly opusEstimateTotal: number
  readonly charsTotal: number
  readonly systemO200k: number
  readonly toolsO200k: number
  readonly runContextO200k: number
  readonly toolCount: number
  readonly sections: readonly PrefixPartTokens[]
  readonly tools: readonly PrefixPartTokens[]
}

let encoder: Tiktoken | null = null

function o200kEncoder() {
  encoder ??= new Tiktoken(o200kBase)
  return encoder
}

export function countO200kTokens(text: string) {
  return o200kEncoder().encode(text, 'all').length
}

export function opusTokenEstimate(o200kTokens: number) {
  return Math.round(o200kTokens * OPUS_TOKENS_PER_O200K_TOKEN)
}

/** The JSON a provider serializes for one tool: name, description and the parameter schema. */
export function serializedTool(tool: PrefixTool) {
  return JSON.stringify({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  })
}

function part(name: string, text: string): PrefixPartTokens {
  return { name, chars: text.length, o200k: countO200kTokens(text) }
}

function sum(parts: readonly PrefixPartTokens[], key: 'chars' | 'o200k') {
  return parts.reduce((total, entry) => total + entry[key], 0)
}

export function measurePrefixTokens(content: PrefixContent): PrefixTokenReport {
  const sections = content.sections.map((section) => part(section.name, section.text))
  const tools = content.tools
    .map((tool) => part(tool.name, serializedTool(tool)))
    .sort((left, right) => right.o200k - left.o200k)
  const runContext = content.runContext.map((text, index) => part(`run-context-${index}`, text))
  const systemO200k = sum(sections, 'o200k')
  const toolsO200k = sum(tools, 'o200k')
  const runContextO200k = sum(runContext, 'o200k')
  const o200kTotal = systemO200k + toolsO200k + runContextO200k
  return {
    o200kTotal,
    opusEstimateTotal: opusTokenEstimate(o200kTotal),
    charsTotal: sum(sections, 'chars') + sum(tools, 'chars') + sum(runContext, 'chars'),
    systemO200k,
    toolsO200k,
    runContextO200k,
    toolCount: tools.length,
    sections,
    tools,
  }
}
