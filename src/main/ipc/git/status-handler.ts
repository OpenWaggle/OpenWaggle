import { BYTES_PER_KIBIBYTE, TRIPLE_FACTOR } from '@shared/constants/constants'
import { GIT_CACHE } from '@shared/constants/timeouts'
import { decodeUnknownOrThrow } from '@shared/schema'
import type {
  GitChangedFile,
  GitFileDiff,
  GitFileStatus,
  GitStatusSummary,
} from '@shared/types/git'
import { choose } from '@shared/utils/decision'
import * as Effect from 'effect/Effect'
import { typedHandle } from '../typed-ipc'
import { isGitRepository, projectPathSchema, runGit, stripSurroundingQuotes } from './shared'

const MODULE_VALUE_8 = 8
const SLICE_ARG_1 = 3
const PARSE_INT_ARG_2 = 10
const SLICE_ARG_1_VALUE_2 = 2

const DIFF_GIT_MAX_BUFFER = MODULE_VALUE_8 * BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE // 8 MB (reduced from shared.ts 32 MB)

const statusCache = new Map<string, { result: GitStatusSummary; timestamp: number }>()

export function invalidateGitStatusCache(projectPath?: string): void {
  if (projectPath) {
    statusCache.delete(projectPath)
  } else {
    statusCache.clear()
  }
}

interface ParsedPorcelainEntry {
  readonly path: string
  readonly status: GitFileStatus
  readonly staged: boolean
}

export function normalizeGitPath(rawPath: string): string {
  const trimmed = rawPath.trim()
  if (!trimmed) return ''

  // Brace rename format, e.g. src/{old => new}.ts
  const braceNormalized = trimmed.replaceAll(/\{([^{}]*?) => ([^{}]*?)\}/g, '$2')
  if (braceNormalized !== trimmed) {
    return stripSurroundingQuotes(braceNormalized.trim())
  }

  // Plain rename formats, e.g. old.txt => new.txt or old.txt -> new.txt
  for (const delimiter of [' => ', ' -> ']) {
    if (trimmed.includes(delimiter)) {
      const parts = trimmed.split(delimiter)
      const candidate = parts[parts.length - 1]?.trim()
      if (candidate) {
        return stripSurroundingQuotes(candidate)
      }
    }
  }

  return stripSurroundingQuotes(trimmed)
}

function mapStatusCode(code: string): GitFileStatus {
  return choose(code)
    .case('M', (): GitFileStatus => 'modified')
    .case('A', (): GitFileStatus => 'added')
    .case('D', (): GitFileStatus => 'deleted')
    .case('R', (): GitFileStatus => 'renamed')
    .case('C', (): GitFileStatus => 'copied')
    .case('?', (): GitFileStatus => 'untracked')
    .catchAll((): GitFileStatus => 'unknown')
}

function parsePorcelain(stdout: string): ParsedPorcelainEntry[] {
  const entries: ParsedPorcelainEntry[] = []
  const lines = stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)

  for (const line of lines) {
    if (line.length < TRIPLE_FACTOR) continue
    const x = line[0] ?? ' '
    const y = line[1] ?? ' '
    const rawPath = line.slice(SLICE_ARG_1).trim()
    const path = normalizeGitPath(rawPath)

    const statusCode = x === '?' && y === '?' ? '?' : y !== ' ' ? y : x
    entries.push({
      path,
      status: mapStatusCode(statusCode),
      staged: x !== ' ' && x !== '?',
    })
  }

  return entries
}

function parseNumstat(stdout: string): Map<string, { additions: number; deletions: number }> {
  const result = new Map<string, { additions: number; deletions: number }>()
  const lines = stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)

  for (const line of lines) {
    const parts = line.split('\t')
    if (parts.length < TRIPLE_FACTOR) continue

    const additions = Number.parseInt(parts[0] ?? '0', PARSE_INT_ARG_2)
    const deletions = Number.parseInt(parts[1] ?? '0', PARSE_INT_ARG_2)
    const rawPath = parts.slice(SLICE_ARG_1_VALUE_2).pop()?.trim()
    const path = rawPath ? normalizeGitPath(rawPath) : undefined
    if (!path) continue

    const safeAdditions = Number.isFinite(additions) ? additions : 0
    const safeDeletions = Number.isFinite(deletions) ? deletions : 0
    result.set(path, { additions: safeAdditions, deletions: safeDeletions })
  }

  return result
}

async function getGitStatus(projectPath: string): Promise<GitStatusSummary> {
  if (!(await isGitRepository(projectPath))) {
    throw new Error('Selected folder is not a Git repository.')
  }

  const [branchResult, porcelainResult, numstatHeadResult, upstreamResult] = await Promise.all([
    runGit(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
    runGit(projectPath, ['status', '--porcelain=v1']),
    runGit(projectPath, ['diff', '--numstat', 'HEAD']),
    runGit(projectPath, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']),
  ])

  let branch = branchResult.stdout.trim() || 'unknown'
  if (branch === 'HEAD') {
    const hashResult = await runGit(projectPath, ['rev-parse', '--short', 'HEAD'])
    if (hashResult.code === 0) {
      branch = `detached@${hashResult.stdout.trim()}`
    }
  }

  let ahead = 0
  let behind = 0
  if (upstreamResult.code === 0) {
    // git rev-list --left-right --count outputs: <ahead>\t<behind>
    const [aheadStr, behindStr] = upstreamResult.stdout.trim().split('\t')
    ahead = Number.parseInt(aheadStr ?? '0', PARSE_INT_ARG_2) || 0
    behind = Number.parseInt(behindStr ?? '0', PARSE_INT_ARG_2) || 0
  }

  const porcelainEntries = parsePorcelain(porcelainResult.stdout)

  let numstat = parseNumstat(numstatHeadResult.stdout)
  if (numstatHeadResult.code !== 0) {
    const [worktreeResult, cachedResult] = await Promise.all([
      runGit(projectPath, ['diff', '--numstat']),
      runGit(projectPath, ['diff', '--cached', '--numstat']),
    ])
    numstat = parseNumstat(`${worktreeResult.stdout}\n${cachedResult.stdout}`)
  }
  const byPath = new Map<string, ParsedPorcelainEntry>()
  for (const entry of porcelainEntries) {
    byPath.set(entry.path, entry)
  }

  // Include files that appear in numstat but not in porcelain snapshots.
  for (const path of numstat.keys()) {
    if (!byPath.has(path)) {
      byPath.set(path, { path, status: 'modified', staged: false })
    }
  }

  const changedFiles: GitChangedFile[] = [...byPath.values()]
    .map((entry) => {
      const lineStats = numstat.get(entry.path)
      return {
        path: entry.path,
        status: entry.status,
        staged: entry.staged,
        additions: lineStats?.additions ?? 0,
        deletions: lineStats?.deletions ?? 0,
      } satisfies GitChangedFile
    })
    .sort((a, b) => a.path.localeCompare(b.path))

  const additions = changedFiles.reduce((sum, file) => sum + file.additions, 0)
  const deletions = changedFiles.reduce((sum, file) => sum + file.deletions, 0)

  return {
    branch,
    additions,
    deletions,
    filesChanged: changedFiles.length,
    changedFiles,
    clean: changedFiles.length === 0,
    ahead,
    behind,
  }
}

export function parseUnifiedDiff(stdout: string): GitFileDiff[] {
  const files: GitFileDiff[] = []
  // Split on "diff --git" boundaries
  const chunks = stdout.split(/^diff --git /m).filter(Boolean)

  for (const chunk of chunks) {
    const lines = chunk.split('\n')
    // Extract file path from "a/path b/path" header
    const header = lines[0] ?? ''
    const bMatch = / b\/(.+)$/.exec(header)
    const filePath = bMatch?.[1] ?? header.trim()

    let additions = 0
    let deletions = 0

    for (const line of lines.slice(1)) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++
      }
      if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++
      }
    }

    if (filePath) {
      files.push({
        path: filePath,
        diff: `diff --git ${chunk}`,
        additions,
        deletions,
      })
    }
  }

  return files
}

export function mergeDiffsByPath(diffs: GitFileDiff[]): GitFileDiff[] {
  const merged = new Map<string, GitFileDiff>()

  for (const diff of diffs) {
    const existing = merged.get(diff.path)
    if (!existing) {
      merged.set(diff.path, diff)
      continue
    }

    merged.set(diff.path, {
      path: diff.path,
      diff: `${existing.diff}\n${diff.diff}`,
      additions: existing.additions + diff.additions,
      deletions: existing.deletions + diff.deletions,
    })
  }

  return [...merged.values()].sort((a, b) => a.path.localeCompare(b.path))
}

async function getGitDiff(projectPath: string): Promise<GitFileDiff[]> {
  if (!(await isGitRepository(projectPath))) {
    throw new Error('Selected folder is not a Git repository.')
  }

  const hasHead = await runGit(projectPath, ['rev-parse', '--verify', 'HEAD'])

  // Single-pass diff for normal repositories.
  if (hasHead.code === 0) {
    const headResult = await runGit(
      projectPath,
      ['diff', '--patch', '--find-renames', '--no-ext-diff', 'HEAD'],
      { maxBuffer: DIFF_GIT_MAX_BUFFER },
    )
    if (headResult.code !== 0) {
      throw new Error(headResult.stderr.trim() || 'Failed to load Git diff.')
    }
    if (!headResult.stdout.trim()) return []
    return parseUnifiedDiff(headResult.stdout)
  }

  // Initial commit path: combine unstaged + staged and merge by file path.
  const [worktreeResult, cachedResult] = await Promise.all([
    runGit(projectPath, ['diff', '--patch', '--no-ext-diff'], { maxBuffer: DIFF_GIT_MAX_BUFFER }),
    runGit(projectPath, ['diff', '--patch', '--cached', '--no-ext-diff'], {
      maxBuffer: DIFF_GIT_MAX_BUFFER,
    }),
  ])

  if (worktreeResult.code !== 0 && cachedResult.code !== 0) {
    throw new Error(
      worktreeResult.stderr.trim() || cachedResult.stderr.trim() || 'Failed to load Git diff.',
    )
  }

  const parsed = [
    ...parseUnifiedDiff(worktreeResult.stdout),
    ...parseUnifiedDiff(cachedResult.stdout),
  ]
  if (parsed.length === 0) return []
  return mergeDiffsByPath(parsed)
}

export function registerGitStatusHandlers(): void {
  typedHandle('git:status', (_event, rawPath: unknown) =>
    Effect.gen(function* () {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
      const cached = statusCache.get(projectPath)
      if (cached && Date.now() - cached.timestamp < GIT_CACHE.STATUS_TTL_MS) {
        return cached.result
      }
      const result = yield* Effect.promise(() => getGitStatus(projectPath))
      statusCache.set(projectPath, { result, timestamp: Date.now() })
      return result
    }),
  )

  typedHandle('git:diff', (_event, rawPath: unknown) =>
    Effect.gen(function* () {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
      return yield* Effect.promise(() => getGitDiff(projectPath))
    }),
  )
}
