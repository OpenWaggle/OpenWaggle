import { open } from 'node:fs/promises'
import type { UsageCostSessionOrigin } from '@shared/types/usage-cost'
import {
  USAGE_COST_TOOLS_MODEL_ID,
  USAGE_COST_TOOLS_MODEL_PROVIDER,
  type UsageCostRecord,
  type UsageCostRecordTokens,
  type UsageCostScanSession,
} from '../../../domain/usage-cost/usage-cost-aggregate'
import {
  type PiSessionEntry,
  type PiSessionUsage,
  parsePiSessionObjectLine,
  piUserMessageText,
} from '../pi-session-jsonl-entry'
import type { UsageCostEstimator } from './pi-usage-cost-scanner'

/**
 * Pi session JSONL parser for the Usage & Cost view. Produces the same
 * records `pi` wrote, attributes auxiliary tool and summary records to Pi's
 * own Tools/summaries bucket, and recognizes OpenWaggle-started sessions from
 * OpenWaggle's own session entries (ADR 0052).
 */

const OPENWAGGLE_CUSTOM_TYPE_PREFIX = 'openwaggle-'
/** Enough of a prompt to tell sessions apart in one row; the row truncates it further. */
const MAX_TITLE_LENGTH = 120
const WHITESPACE_RUN = /\s+/gu

export async function parseSessionFile(file: string, estimateCost: UsageCostEstimator) {
  const state: ParseState = {
    sessionId: null,
    name: null,
    firstPrompt: null,
    cwd: null,
    startedAtMs: null,
    lastActivityMs: null,
    origin: 'other-pi-clients',
    lastModel: null,
  }
  const records: UsageCostRecord[] = []

  for (const line of await readLines(file)) {
    const entry = parsePiSessionObjectLine(line)
    if (entry === null) continue
    absorbEntry(state, entry)
    const extracted = extractRecords(entry, state.lastModel)
    records.push(...extracted)
  }

  const session: UsageCostScanSession = {
    file,
    sessionId: state.sessionId,
    title: sessionTitle(state),
    cwd: state.cwd,
    // The scanner fills this in per cwd with a cache; parse stays single-file.
    resolvedProjectPath: null,
    origin: state.origin,
    startedAtMs: state.startedAtMs,
    lastActivityMs: state.lastActivityMs,
    records: records.map((record) => applyEstimate(record, estimateCost)),
  }
  return session
}

interface ParseState {
  sessionId: string | null
  /** The latest Pi `/name`; an empty name clears it, as in Pi's own session list. */
  name: string | null
  firstPrompt: string | null
  cwd: string | null
  startedAtMs: number | null
  lastActivityMs: number | null
  origin: UsageCostSessionOrigin
  lastModel: { provider: string; modelId: string } | null
}

function shortened(text: string) {
  const collapsed = text.replace(WHITESPACE_RUN, ' ').trim()
  if (collapsed.length <= MAX_TITLE_LENGTH) return collapsed
  return `${collapsed.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`
}

/**
 * What a Session row is called (#356): the latest Pi `/name`, else the first prompt, which is
 * also what discovery titles an adopted `pi` session from (ADR 0051).
 */
function sessionTitle(state: ParseState) {
  const title = state.name ?? state.firstPrompt
  return title ? shortened(title) || null : null
}

function absorbTitle(state: ParseState, entry: PiSessionEntry) {
  if (entry.type === 'session_info') {
    state.name = entry.name?.trim() ? entry.name : null
    return
  }
  if (state.firstPrompt !== null || entry.type !== 'message' || entry.message === undefined) {
    return
  }
  const text = piUserMessageText(entry.message)
  if (text?.trim()) state.firstPrompt = text
}

function absorbEntry(state: ParseState, entry: PiSessionEntry) {
  const { type } = entry
  absorbTitle(state, entry)

  if (type === 'session') {
    if (entry.id !== undefined) state.sessionId = entry.id
    if (entry.cwd !== undefined) state.cwd = entry.cwd
    const headerTimestamp = parseTimestampMs(entry.timestamp)
    if (headerTimestamp !== null) state.startedAtMs = headerTimestamp
    return
  }

  const timestampMs = parseTimestampMs(entry.timestamp)
  if (
    timestampMs !== null &&
    (state.lastActivityMs === null || timestampMs > state.lastActivityMs)
  ) {
    state.lastActivityMs = timestampMs
  }

  if (type === 'custom' && entry.customType !== undefined) {
    if (entry.customType.startsWith(OPENWAGGLE_CUSTOM_TYPE_PREFIX)) state.origin = 'openwaggle'
    return
  }

  if (type === 'model_change' && entry.provider !== undefined && entry.modelId !== undefined) {
    state.lastModel = { provider: entry.provider, modelId: entry.modelId }
  }
}

function extractRecords(
  entry: PiSessionEntry,
  lastModel: { provider: string; modelId: string } | null,
) {
  const timestampMs = parseTimestampMs(entry.timestamp)
  if (timestampMs === null) {
    const record: UsageCostRecord[] = []
    return record
  }

  if (entry.type === 'message') return messageRecords(entry, timestampMs, lastModel)
  if (entry.type === 'usage') return directUsageRecords(entry, timestampMs)
  if (entry.type === 'compaction' || entry.type === 'branch_summary') {
    return summaryRecords(entry, timestampMs)
  }
  const record: UsageCostRecord[] = []
  return record
}

function messageRecords(
  entry: PiSessionEntry,
  timestampMs: number,
  lastModel: { provider: string; modelId: string } | null,
) {
  const { message } = entry
  if (message?.usage === undefined) {
    const record: UsageCostRecord[] = []
    return record
  }

  if (message.role === 'assistant') {
    const provider = message.provider ?? lastModel?.provider
    const modelId = message.model ?? lastModel?.modelId
    if (provider === undefined || modelId === undefined) {
      const record: UsageCostRecord[] = []
      return record
    }
    const record: UsageCostRecord[] = [createRecord(timestampMs, provider, modelId, message.usage)]
    return record
  }

  if (message.role === 'toolResult') {
    const record: UsageCostRecord[] = [
      createRecord(
        timestampMs,
        USAGE_COST_TOOLS_MODEL_PROVIDER,
        USAGE_COST_TOOLS_MODEL_ID,
        message.usage,
      ),
    ]
    return record
  }
  const record: UsageCostRecord[] = []
  return record
}

function directUsageRecords(entry: PiSessionEntry, timestampMs: number) {
  if (entry.provider === undefined || entry.model === undefined) {
    const record: UsageCostRecord[] = []
    return record
  }
  if (entry.usage === undefined) {
    const record: UsageCostRecord[] = []
    return record
  }
  const record: UsageCostRecord[] = [
    createRecord(timestampMs, entry.provider, entry.model, entry.usage),
  ]
  return record
}

function summaryRecords(entry: PiSessionEntry, timestampMs: number) {
  if (entry.usage === undefined) {
    const record: UsageCostRecord[] = []
    return record
  }
  const record: UsageCostRecord[] = [
    createRecord(
      timestampMs,
      USAGE_COST_TOOLS_MODEL_PROVIDER,
      USAGE_COST_TOOLS_MODEL_ID,
      entry.usage,
    ),
  ]
  return record
}

function createRecord(
  timestampMs: number,
  provider: string,
  modelId: string,
  usage: PiSessionUsage,
) {
  const tokens: UsageCostRecordTokens = {
    input: usage.input ?? 0,
    output: usage.output ?? 0,
    cacheRead: usage.cacheRead ?? 0,
    cacheWrite: usage.cacheWrite ?? 0,
  }
  const totalTokens =
    usage.totalTokens ?? tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite
  const record: UsageCostRecord = {
    timestampMs,
    provider,
    modelId,
    tokens,
    totalTokens,
    recordedCostUsd: usage.cost?.total ?? null,
    estimatedCostUsd: null,
  }
  return record
}

function applyEstimate(record: UsageCostRecord, estimateCost: UsageCostEstimator) {
  if (record.recordedCostUsd !== null) return record
  const estimatedCostUsd = estimateCost(record.provider, record.modelId, record.tokens)
  if (estimatedCostUsd === null) return record
  const result: UsageCostRecord = { ...record, estimatedCostUsd }
  return result
}

function parseTimestampMs(value: string | undefined) {
  if (value === undefined) return null
  const parsed = Date.parse(value)
  const result: number | null = Number.isNaN(parsed) ? null : parsed
  return result
}

/** Complete lines of a file; a partially written last line is dropped. */
async function readLines(file: string) {
  const handle = await open(file, 'r')
  try {
    const content = await handle.readFile({ encoding: 'utf8' })
    const lines = content.split('\n')
    if (lines.length > 0) lines.pop()
    return lines
  } finally {
    await handle.close()
  }
}
