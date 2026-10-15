import { open } from 'node:fs/promises'
import type { UsageCostSessionOrigin } from '@shared/types/usage-cost'
import {
  USAGE_COST_TOOLS_MODEL_ID,
  USAGE_COST_TOOLS_MODEL_PROVIDER,
  type UsageCostRecord,
  type UsageCostRecordTokens,
  type UsageCostScanSession,
} from '../../../domain/usage-cost/usage-cost-aggregate'
import type { UsageCostEstimator } from './pi-usage-cost-scanner'

/**
 * Pi session JSONL parser for the Usage & Cost view. Produces the same
 * records `pi` wrote, attributes auxiliary tool and summary records to Pi's
 * own Tools/summaries bucket, and recognizes OpenWaggle-started sessions from
 * OpenWaggle's own session entries (ADR 0052).
 */

const OPENWAGGLE_CUSTOM_TYPE_PREFIX = 'openwaggle-'

export async function parseSessionFile(
  file: string,
  estimateCost: UsageCostEstimator,
): Promise<UsageCostScanSession> {
  const state: {
    sessionId: string | null
    cwd: string | null
    startedAtMs: number | null
    lastActivityMs: number | null
    origin: UsageCostSessionOrigin
    lastModel: { provider: string; modelId: string } | null
  } = {
    sessionId: null,
    cwd: null,
    startedAtMs: null,
    lastActivityMs: null,
    origin: 'other-pi-clients',
    lastModel: null,
  }
  const records: UsageCostRecord[] = []

  for (const line of await readLines(file)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let entry: unknown
    try {
      entry = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!isRecord(entry)) continue

    absorbEntry(state, entry)
    const extracted = extractRecords(entry, state.lastModel)
    records.push(...extracted)
  }

  return {
    file,
    sessionId: state.sessionId,
    cwd: state.cwd,
    // The scanner fills this in per cwd with a cache; parse stays single-file.
    resolvedProjectPath: null,
    origin: state.origin,
    startedAtMs: state.startedAtMs,
    lastActivityMs: state.lastActivityMs,
    records: records.map((record) => applyEstimate(record, estimateCost)),
  }
}

interface ParseState {
  sessionId: string | null
  cwd: string | null
  startedAtMs: number | null
  lastActivityMs: number | null
  origin: UsageCostSessionOrigin
  lastModel: { provider: string; modelId: string } | null
}

function absorbEntry(state: ParseState, entry: { readonly [key: string]: unknown }) {
  const type = entry.type

  if (type === 'session') {
    if (typeof entry.id === 'string') state.sessionId = entry.id
    if (typeof entry.cwd === 'string') state.cwd = entry.cwd
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

  if (type === 'custom' && typeof entry.customType === 'string') {
    if (entry.customType.startsWith(OPENWAGGLE_CUSTOM_TYPE_PREFIX)) state.origin = 'openwaggle'
    return
  }

  if (
    type === 'model_change' &&
    typeof entry.provider === 'string' &&
    typeof entry.modelId === 'string'
  ) {
    state.lastModel = { provider: entry.provider, modelId: entry.modelId }
  }
}

function extractRecords(
  entry: { readonly [key: string]: unknown },
  lastModel: { provider: string; modelId: string } | null,
): UsageCostRecord[] {
  const timestampMs = parseTimestampMs(entry.timestamp)
  if (timestampMs === null) return []

  if (entry.type === 'message') return messageRecords(entry, timestampMs, lastModel)
  if (entry.type === 'usage') return directUsageRecords(entry, timestampMs)
  if (entry.type === 'compaction' || entry.type === 'branch_summary') {
    return summaryRecords(entry, timestampMs)
  }
  return []
}

function messageRecords(
  entry: { readonly [key: string]: unknown },
  timestampMs: number,
  lastModel: { provider: string; modelId: string } | null,
): UsageCostRecord[] {
  const message = entry.message
  if (!isRecord(message) || !isRecord(message.usage)) return []

  if (message.role === 'assistant') {
    const provider = typeof message.provider === 'string' ? message.provider : lastModel?.provider
    const modelId = typeof message.model === 'string' ? message.model : lastModel?.modelId
    if (provider === undefined || modelId === undefined) return []
    return [createRecord(timestampMs, provider, modelId, message.usage)]
  }

  if (message.role === 'toolResult') {
    return [
      createRecord(
        timestampMs,
        USAGE_COST_TOOLS_MODEL_PROVIDER,
        USAGE_COST_TOOLS_MODEL_ID,
        message.usage,
      ),
    ]
  }
  return []
}

function directUsageRecords(
  entry: { readonly [key: string]: unknown },
  timestampMs: number,
): UsageCostRecord[] {
  if (typeof entry.provider !== 'string' || typeof entry.model !== 'string') return []
  if (!isRecord(entry.usage)) return []
  return [createRecord(timestampMs, entry.provider, entry.model, entry.usage)]
}

function summaryRecords(
  entry: { readonly [key: string]: unknown },
  timestampMs: number,
): UsageCostRecord[] {
  if (!isRecord(entry.usage)) return []
  return [
    createRecord(
      timestampMs,
      USAGE_COST_TOOLS_MODEL_PROVIDER,
      USAGE_COST_TOOLS_MODEL_ID,
      entry.usage,
    ),
  ]
}

function createRecord(
  timestampMs: number,
  provider: string,
  modelId: string,
  usage: { readonly [key: string]: unknown },
): UsageCostRecord {
  const tokens: UsageCostRecordTokens = {
    input: tokenCount(usage.input),
    output: tokenCount(usage.output),
    cacheRead: tokenCount(usage.cacheRead),
    cacheWrite: tokenCount(usage.cacheWrite),
  }
  const totalTokens =
    typeof usage.totalTokens === 'number'
      ? usage.totalTokens
      : tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite
  return {
    timestampMs,
    provider,
    modelId,
    tokens,
    totalTokens,
    recordedCostUsd: recordedCost(usage),
    estimatedCostUsd: null,
  }
}

function recordedCost(usage: { readonly [key: string]: unknown }): number | null {
  const cost = usage.cost
  if (!isRecord(cost)) return null
  if (typeof cost.total !== 'number' || !Number.isFinite(cost.total)) return null
  return cost.total
}

function applyEstimate(record: UsageCostRecord, estimateCost: UsageCostEstimator): UsageCostRecord {
  if (record.recordedCostUsd !== null) return record
  const estimatedCostUsd = estimateCost(record.provider, record.modelId, record.tokens)
  if (estimatedCostUsd === null) return record
  return { ...record, estimatedCostUsd }
}

function isRecord(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tokenCount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function parseTimestampMs(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

/** Complete lines of a file; a partially written last line is dropped. */
async function readLines(file: string): Promise<string[]> {
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
