import { open, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { calculateCost, createModels, type Usage as PiUsage } from '@earendil-works/pi-ai'
import { getAgentDir } from '@earendil-works/pi-coding-agent'
import type { UsageCostSessionOrigin } from '@shared/types/usage-cost'
import {
  USAGE_COST_TOOLS_MODEL_ID,
  USAGE_COST_TOOLS_MODEL_PROVIDER,
  type UsageCostRecord,
  type UsageCostRecordTokens,
  type UsageCostScanSession,
} from '../../../domain/usage-cost/usage-cost-aggregate'

/**
 * Pi session scanner for the Usage & Cost view (ADR 0052). Parses Pi's own
 * session JSONL records — the same records `pi` writes — into usage records,
 * recognizes OpenWaggle-started sessions from OpenWaggle's own session entries,
 * and caches parsed files by `(size, mtime)` because transcripts are
 * append-only: an unchanged file can never yield different usage.
 */

/** How much of the token budget of a scan is spent re-reading unchanged files. */
const PI_SESSION_FILE_SUFFIX = '.jsonl'

/**
 * Parsed-session cache bound. Histories beyond this many most-recently-modified
 * files are re-parsed on the next scan instead of being held in memory.
 */
const MAX_CACHED_SESSION_FILES = 1500

const OPENWAGGLE_CUSTOM_TYPE_PREFIX = 'openwaggle-'

export type UsageCostEstimator = (
  provider: string,
  modelId: string,
  tokens: UsageCostRecordTokens,
) => number | null

export interface PiUsageCostScanner {
  readonly collectSessions: (input: {
    /** Inclusive lower record-time bound; `null` scans every file. */
    readonly rangeStartMs: number | null
  }) => Promise<{
    readonly sessions: readonly UsageCostScanSession[]
    readonly stats: {
      readonly scannedFiles: number
      readonly scannedFilesCached: number
      readonly scanDurationMs: number
    }
  }>
}

export interface CreatePiUsageCostScannerOptions {
  readonly sessionsRoot?: string
  /** Defaults to Pi's own model catalog via `calculateCost`. */
  readonly costEstimator?: UsageCostEstimator
}

interface SessionCacheEntry {
  readonly size: number
  readonly mtimeMs: number
  readonly session: UsageCostScanSession
}

export function createPiUsageCostScanner(
  options: CreatePiUsageCostScannerOptions = {},
): PiUsageCostScanner {
  const cache = new Map<string, SessionCacheEntry>()
  const estimateCost = options.costEstimator ?? createPiCatalogCostEstimator()

  const collectSessions: PiUsageCostScanner['collectSessions'] = async (input) => {
    const startedAt = Date.now()
    const sessionsRoot = options.sessionsRoot ?? path.join(getAgentDir(), 'sessions')
    const files = await listSessionFiles(sessionsRoot)

    let scannedFilesCached = 0
    const sessions: UsageCostScanSession[] = []
    for (const file of files) {
      const fileStat = await stat(file)
      // Records are written before the last file write, so a file modified
      // before the window starts cannot contain in-window records.
      if (input.rangeStartMs !== null && fileStat.mtimeMs < input.rangeStartMs) continue

      const cached = cache.get(file)
      if (cached && cached.size === fileStat.size && cached.mtimeMs === fileStat.mtimeMs) {
        scannedFilesCached += 1
        sessions.push(cached.session)
        continue
      }

      const session = await parseSessionFile(file, estimateCost)
      cache.set(file, { size: fileStat.size, mtimeMs: fileStat.mtimeMs, session })
      sessions.push(session)
    }
    evictOldestCacheEntries()

    return {
      sessions,
      stats: {
        scannedFiles: files.length,
        scannedFilesCached,
        scanDurationMs: Date.now() - startedAt,
      },
    }
  }

  function evictOldestCacheEntries(): void {
    while (cache.size > MAX_CACHED_SESSION_FILES) {
      let oldestKey: string | null = null
      let oldestMtime = Number.POSITIVE_INFINITY
      for (const [key, entry] of cache) {
        if (entry.mtimeMs < oldestMtime) {
          oldestMtime = entry.mtimeMs
          oldestKey = key
        }
      }
      if (oldestKey === null) break
      cache.delete(oldestKey)
    }
  }

  return { collectSessions }
}

async function listSessionFiles(sessionsRoot: string): Promise<string[]> {
  let directoryNames: string[]
  try {
    directoryNames = await readdir(sessionsRoot)
  } catch {
    return []
  }
  const files: string[] = []
  for (const directoryName of directoryNames) {
    const directory = path.join(sessionsRoot, directoryName)
    let entries: string[]
    try {
      entries = await readdir(directory)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.endsWith(PI_SESSION_FILE_SUFFIX)) files.push(path.join(directory, entry))
    }
  }
  return files
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

async function parseSessionFile(
  file: string,
  estimateCost: UsageCostEstimator,
): Promise<UsageCostScanSession> {
  let sessionId: string | null = null
  let cwd: string | null = null
  let startedAtMs: number | null = null
  let lastActivityMs: number | null = null
  let origin: UsageCostSessionOrigin = 'other-pi-clients'
  let lastModel: { provider: string; modelId: string } | null = null
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
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const type = record.type

    if (type === 'session') {
      if (typeof record.id === 'string') sessionId = record.id
      if (typeof record.cwd === 'string') cwd = record.cwd
      const headerTimestamp = parseTimestampMs(record.timestamp)
      if (headerTimestamp !== null) startedAtMs = headerTimestamp
      continue
    }

    const timestampMs = parseTimestampMs(record.timestamp)
    if (timestampMs !== null && (lastActivityMs === null || timestampMs > lastActivityMs)) {
      lastActivityMs = timestampMs
    }

    if (type === 'custom' && typeof record.customType === 'string') {
      if (record.customType.startsWith(OPENWAGGLE_CUSTOM_TYPE_PREFIX)) origin = 'openwaggle'
      continue
    }

    if (type === 'model_change') {
      const provider = record.provider
      const modelId = record.modelId
      if (typeof provider === 'string' && typeof modelId === 'string') {
        lastModel = { provider, modelId }
      }
      continue
    }

    const extracted = extractRecords(record, type, timestampMs, lastModel)
    records.push(...extracted)
  }

  return {
    file,
    sessionId,
    cwd,
    origin,
    startedAtMs,
    lastActivityMs,
    records: records.map((record) => applyEstimate(record, estimateCost)),
  }
}

function isRecord(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function extractRecords(
  record: Record<string, unknown>,
  type: unknown,
  timestampMs: number | null,
  lastModel: { provider: string; modelId: string } | null,
): UsageCostRecord[] {
  if (timestampMs === null) return []

  if (type === 'message') {
    const message = record.message
    if (!isRecord(message)) return []
    const usage = message.usage
    if (!isRecord(usage)) return []

    if (message.role === 'assistant') {
      const provider = typeof message.provider === 'string' ? message.provider : lastModel?.provider
      const modelId = typeof message.model === 'string' ? message.model : lastModel?.modelId
      if (provider === undefined || modelId === undefined) return []
      return [createRecord(timestampMs, provider, modelId, usage)]
    }

    if (message.role === 'toolResult') {
      return [
        createRecord(
          timestampMs,
          USAGE_COST_TOOLS_MODEL_PROVIDER,
          USAGE_COST_TOOLS_MODEL_ID,
          usage,
        ),
      ]
    }
    return []
  }

  if (type === 'usage') {
    const provider = record.provider
    const modelId = record.model
    const usage = record.usage
    if (typeof provider !== 'string' || typeof modelId !== 'string') return []
    if (!isRecord(usage)) return []
    return [createRecord(timestampMs, provider, modelId, usage)]
  }

  if (type === 'compaction' || type === 'branch_summary') {
    const usage = record.usage
    if (!isRecord(usage)) return []
    return [
      createRecord(timestampMs, USAGE_COST_TOOLS_MODEL_PROVIDER, USAGE_COST_TOOLS_MODEL_ID, usage),
    ]
  }

  return []
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

function tokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function parseTimestampMs(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Cost tier 2 (CONTEXT.md: Cost tier): compute the cost from Pi's own model
 * rates — the same `calculateCost` Pi uses — for records written without a
 * cost. Returns `null` for models the catalog does not know (Cost tier 3).
 */
export function createPiCatalogCostEstimator(): UsageCostEstimator {
  let models: ReturnType<typeof createModels> | null = null
  return (provider, modelId, tokens) => {
    if (provider === USAGE_COST_TOOLS_MODEL_PROVIDER && modelId === USAGE_COST_TOOLS_MODEL_ID)
      return null
    models ??= createModels()
    const model = models.getModel(provider, modelId)
    if (!model) return null
    const usage: PiUsage = {
      ...tokens,
      totalTokens: tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    }
    return calculateCost(model, usage).total
  }
}
