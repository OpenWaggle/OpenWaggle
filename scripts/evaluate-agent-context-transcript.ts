import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function numberField(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'number' ? value : 0
}

function parseLines(text: string) {
  return text.split('\n').flatMap((line) => {
    if (line.trim() === '') return []
    try {
      const parsed: unknown = JSON.parse(line)
      return isRecord(parsed) ? [parsed] : []
    } catch {
      return []
    }
  })
}

/** Tool names of one assistant message: tool calls, plus `tools.x(` calls inside codemode code. */
function toolNamesOf(content: unknown) {
  if (!Array.isArray(content)) return []
  return content.flatMap((block: unknown) => {
    if (!isRecord(block) || block.type !== 'toolCall' || typeof block.name !== 'string') return []
    const args = isRecord(block.arguments) ? block.arguments : {}
    const code = typeof args.code === 'string' ? args.code : ''
    const nested = [...code.matchAll(CODEMODE_TOOL_PATTERN)].map((match) => `codemode:${match[1] ?? ''}`)
    return [block.name, ...nested]
  })
}

function textOf(content: unknown) {
  if (!Array.isArray(content)) return typeof content === 'string' ? content : ''
  return content
    .map((block: unknown) => (isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .join('')
}

export function emptyUsage(): UsageTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 }
}

export function addUsage(totals: UsageTotals, usage: Record<string, unknown>) {
  totals.input += numberField(usage, 'input')
  totals.output += numberField(usage, 'output')
  totals.cacheRead += numberField(usage, 'cacheRead')
  totals.cacheWrite += numberField(usage, 'cacheWrite')
  totals.costUsd += isRecord(usage.cost) ? numberField(usage.cost, 'total') : 0
}

export function summarizeSessionFile(file: string, text: string): SessionTranscriptSummary {
  const usage = emptyUsage()
  const toolNames: string[] = []
  let modelCalls = 0
  let compactions = 0
  let finalText = ''
  let isRoot = true
  for (const entry of parseLines(text)) {
    if (entry.type === 'compaction') compactions += 1
    if (entry.type === 'custom' && entry.customType === 'openwaggle-run-identity' && JSON.stringify(entry).includes('parentSessionTitle')) {
      isRoot = false
    }
    const message = isRecord(entry.message) ? entry.message : null
    if (entry.type !== 'message' || !message || message.role !== 'assistant') continue
    modelCalls += 1
    if (isRecord(message.usage)) addUsage(usage, message.usage)
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
  return Promise.all(files.map(async (file) => summarizeSessionFile(file, await readFile(file, 'utf8'))))
}
