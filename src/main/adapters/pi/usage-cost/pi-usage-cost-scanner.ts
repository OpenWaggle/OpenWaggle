import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { calculateCost, createModels, type Usage as PiUsage } from '@earendil-works/pi-ai'
import { getAgentDir } from '@earendil-works/pi-coding-agent'
import type {
  UsageCostRecordTokens,
  UsageCostScanSession,
} from '../../../domain/usage-cost/usage-cost-aggregate'
import { parseSessionFile } from './pi-usage-cost-parse'

/**
 * Pi session scanner for the Usage & Cost view. Parses Pi's own session
 * records — the same records `pi` writes — and caches parsed files by
 * `(size, mtime)` because transcripts are append-only: an unchanged file can
 * never yield different usage.
 */

const PI_SESSION_FILE_SUFFIX = '.jsonl'

/**
 * Parsed-session cache bound. Histories beyond this many most-recently-modified
 * files are re-parsed on the next scan instead of being held in memory.
 */
const MAX_CACHED_SESSION_FILES = 1500

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

  function evictOldestCacheEntries() {
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

async function listSessionFiles(sessionsRoot: string) {
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

/**
 * Cost tier 2 (CONTEXT.md: Cost tier): compute the cost from Pi's own model
 * rates — the same `calculateCost` Pi uses — for records written without a
 * cost. Returns `null` for models the catalog does not know (Cost tier 3).
 */
export function createPiCatalogCostEstimator(): UsageCostEstimator {
  let models: ReturnType<typeof createModels> | null = null
  return (provider, modelId, tokens) => {
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
