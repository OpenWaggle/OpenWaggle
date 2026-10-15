import { readdir, readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { calculateCost, createModels, type Usage as PiUsage } from '@earendil-works/pi-ai'
import { getAgentDir } from '@earendil-works/pi-coding-agent'
import type {
  UsageCostRecordTokens,
  UsageCostScanSession,
} from '../../../domain/usage-cost/usage-cost-aggregate'
import {
  isPathInsideProject,
  owningProject,
  type ProjectLocation,
  projectLocations,
} from '../pi-session-project-paths'
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
    /** OpenWaggle's known project paths, for attributing sessions to the project a cwd sits inside. */
    readonly knownProjects?: readonly string[]
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
  /** Roots under which a session counts as temporary rather than project-bound. */
  readonly temporaryRoots?: readonly string[]
}

interface SessionCacheEntry {
  readonly size: number
  readonly mtimeMs: number
  readonly session: UsageCostScanSession
}

/**
 * Structural project resolution. A managed worktree is a real git worktree, so
 * its `.git` pointer names the primary repository — the project identity is
 * resolved from git itself, never from the UUID worktree folder name.
 */
export function resolvePrimaryRepositoryFromGitDir(gitDir: string): string | null {
  const normalized = gitDir.replace(/\\/g, '/')
  const hadWorktreeSuffix = /\/worktrees\/[^/]+$/.test(normalized)
  const withoutWorktree = normalized.replace(/\/worktrees\/[^/]+$/, '')
  if (!hadWorktreeSuffix) {
    if (!withoutWorktree.endsWith('/.git')) return null
    return withoutWorktree.slice(0, -'/.git'.length)
  }
  const primary = withoutWorktree.endsWith('/.git')
    ? withoutWorktree.slice(0, -'/.git'.length)
    : withoutWorktree
  return primary === '' ? null : primary
}

export function createPiUsageCostScanner(
  options: CreatePiUsageCostScannerOptions = {},
): PiUsageCostScanner {
  const cache = new Map<string, SessionCacheEntry>()
  const estimateCost = options.costEstimator ?? createPiCatalogCostEstimator()
  const projectIdentityByCwd = new Map<string, string | null>()
  const temporaryRoots = (options.temporaryRoots ?? ['/private/tmp', '/tmp', os.tmpdir()]).toSorted(
    (a, b) => b.length - a.length,
  )
  let knownProjectLocations: readonly ProjectLocation[] = []
  let knownProjectsSource = ''

  const collectSessions: PiUsageCostScanner['collectSessions'] = async (input) => {
    const startedAt = Date.now()
    const sessionsRoot = options.sessionsRoot ?? path.join(getAgentDir(), 'sessions')
    const files = await listSessionFiles(sessionsRoot)
    knownProjectLocations = await syncKnownProjectLocations(input.knownProjects)

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

      const parsed = await parseSessionFile(file, estimateCost)
      const session = {
        ...parsed,
        resolvedProjectPath: await resolveProjectIdentity(parsed.cwd),
      }
      cache.set(file, { size: fileStat.size, mtimeMs: fileStat.mtimeMs, session })
      sessions.push(session)
    }
    evictOldestCacheEntries()

    return {
      sessions: sessions.map(attributeToKnownProject),
      stats: {
        scannedFiles: files.length,
        scannedFilesCached,
        scanDurationMs: Date.now() - startedAt,
      },
    }
  }

  /** Longest temporary root wins, so a scratch dir inside `/tmp` still resolves to its exact root. */
  async function resolveProjectIdentity(cwd: string | null): Promise<string | null> {
    if (cwd === null) return null
    const cachedIdentity = projectIdentityByCwd.get(cwd)
    if (cachedIdentity !== undefined) return cachedIdentity
    const identity =
      temporaryRoots.find((root) => isPathInsideProject(cwd, root)) ??
      (await resolveWorktreePrimaryRepository(cwd))
    projectIdentityByCwd.set(cwd, identity)
    return identity
  }

  async function resolveWorktreePrimaryRepository(cwd: string): Promise<string | null> {
    let pointer: string
    try {
      pointer = await readFile(path.join(cwd, '.git'), 'utf8')
    } catch {
      return null
    }
    if (!pointer.startsWith('gitdir:')) return null
    return resolvePrimaryRepositoryFromGitDir(pointer.slice('gitdir:'.length).trim())
  }

  async function syncKnownProjectLocations(knownProjects: readonly string[] | undefined) {
    const source = (knownProjects ?? []).join('\u0000')
    if (source === knownProjectsSource) return knownProjectLocations
    knownProjectsSource = source
    knownProjectLocations = await projectLocations(knownProjects ?? [])
    return knownProjectLocations
  }

  function attributeToKnownProject(session: UsageCostScanSession): UsageCostScanSession {
    if (session.resolvedProjectPath !== null || session.cwd === null) return session
    const owner = owningProject(session.cwd, knownProjectLocations)
    if (owner === null) return session
    return { ...session, resolvedProjectPath: owner }
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
