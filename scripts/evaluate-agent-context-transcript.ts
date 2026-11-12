import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { Schema } from '@shared/schema'
import { objectFields, unknownField } from './support/object-fields'

/**
 * Reads the Pi session files a measured Run wrote (`<agent dir>/sessions/**.jsonl`): the tools each
 * Session called, its token usage and cost, compactions, and the last assistant text.
 */
export interface SessionTranscriptSummary {
  readonly file: string
  readonly isRoot: boolean
  readonly finalText: string
  readonly toolNames: readonly string[]
  readonly modelCalls: number
  readonly compactions: number
  readonly usage: UsageTotals
}

export interface UsageTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  costUsd: number
}

const CODEMODE_TOOL_PATTERN = /tools\.([A-Za-z0-9_]+)\s*\(/g

/** The Pi session entry fields the summary reads; a field of another type reads as absent. */
const sessionEntrySchema = Schema.Struct({
  type: unknownField,
  customType: unknownField,
  message: unknownField,
})
const assistantMessageSchema = Schema.Struct({
  role: Schema.Literal('assistant'),
  usage: unknownField,
  content: unknownField,
})
/** Pi's message usage; `cost.total` is its cost in US dollars. */
const messageUsageSchema = Schema.Struct({
  input: unknownField,
  output: unknownField,
  cacheRead: unknownField,
  cacheWrite: unknownField,
  cost: unknownField,
})
const usageCostSchema = Schema.Struct({ total: unknownField })
const toolCallBlockSchema = Schema.Struct({
  type: Schema.Literal('toolCall'),
  name: Schema.String,
  arguments: unknownField,
})
const codemodeArgumentsSchema = Schema.Struct({ code: Schema.String })
const textBlockSchema = Schema.Struct({ type: Schema.Literal('text'), text: Schema.String })

/** Pi's message usage as this module reads it. */
export type MessageUsage = Schema.Schema.Type<typeof messageUsageSchema>

function numberOrZero(value: unknown) {
  return typeof value === 'number' ? value : 0
}

function parseLines(text: string) {
  return text.split('\n').flatMap((line) => {
    if (line.trim() === '') return []
    try {
      const parsed: unknown = JSON.parse(line)
      const entry = objectFields(sessionEntrySchema, parsed)
      return entry === undefined ? [] : [entry]
    } catch {
      return []
    }
  })
}

/** Tool names of one assistant message: tool calls, plus `tools.x(` calls inside codemode code. */
function toolNamesOf(content: unknown) {
  if (!Array.isArray(content)) return []
  return content.flatMap((block: unknown) => {
    if (!Schema.is(toolCallBlockSchema)(block)) return []
    const code = objectFields(codemodeArgumentsSchema, block.arguments)?.code ?? ''
    const nested = [...code.matchAll(CODEMODE_TOOL_PATTERN)].map(
      (match) => `codemode:${match[1] ?? ''}`,
    )
    return [block.name, ...nested]
  })
}

function textOf(content: unknown) {
  if (!Array.isArray(content)) return typeof content === 'string' ? content : ''
  return content
    .map((block: unknown) => (Schema.is(textBlockSchema)(block) ? block.text : ''))
    .join('')
}

export function emptyUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 } satisfies UsageTotals
}

export function addUsage(totals: UsageTotals, usage: MessageUsage) {
  totals.input += numberOrZero(usage.input)
  totals.output += numberOrZero(usage.output)
  totals.cacheRead += numberOrZero(usage.cacheRead)
  totals.cacheWrite += numberOrZero(usage.cacheWrite)
  totals.costUsd += numberOrZero(objectFields(usageCostSchema, usage.cost)?.total)
}

export function summarizeSessionFile(file: string, text: string) {
  const usage = emptyUsage()
  const toolNames: string[] = []
  let modelCalls = 0
  let compactions = 0
  let finalText = ''
  let isRoot = true
  for (const entry of parseLines(text)) {
    if (entry.type === 'compaction') compactions += 1
    if (
      entry.type === 'custom' &&
      entry.customType === 'openwaggle-run-identity' &&
      JSON.stringify(entry).includes('parentSessionTitle')
    ) {
      isRoot = false
    }
    const message = objectFields(assistantMessageSchema, entry.message)
    if (entry.type !== 'message' || message === undefined) continue
    modelCalls += 1
    const messageUsage = objectFields(messageUsageSchema, message.usage)
    if (messageUsage !== undefined) addUsage(usage, messageUsage)
    toolNames.push(...toolNamesOf(message.content))
    const text = textOf(message.content).trim()
    if (text.length > 0) finalText = text
  }
  return { file, isRoot, finalText, toolNames, modelCalls, compactions, usage }
}

async function sessionFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(
    entries.map((entry) => {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) return sessionFiles(full)
      return Promise.resolve(entry.name.endsWith('.jsonl') ? [full] : [])
    }),
  )
  return nested.flat()
}

export async function readRunTranscripts(agentDir: string) {
  const files = await sessionFiles(path.join(agentDir, 'sessions'))
  return Promise.all(
    files.map(async (file) => summarizeSessionFile(file, await readFile(file, 'utf8'))),
  )
}
