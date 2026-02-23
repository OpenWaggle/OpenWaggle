import type {
  GitChangedFile,
  GitFileDiff,
  GitFileStatus,
  GitStatusSummary,
} from '@shared/types/git'
import { safeHandle } from '../typed-ipc'
import { isGitRepository, projectPathSchema, runGit, stripSurroundingQuotes } from './shared'

const GIT_STATUS_CACHE_TTL = 2000 // 2 seconds
const DIFF_GIT_MAX_BUFFER = 8 * 1024 * 1024 // 8 MB (reduced from shared.ts 32 MB)

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
  switch (code) {
    case 'M':
      return 'modified'
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case '?':
      return 'untracked'
    default:
      return 'unknown'
  }
}

function parsePorcelain(stdout: string): ParsedPorcelainEntry[] {
  const entries: ParsedPorcelainEntry[] = []
  const lines = stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)

  for (const line of lines) {
    if (line.length < 3) continue
    const x = line[0] ?? ' '
    const y = line[1] ?? ' '
    const rawPath = line.slice(3).trim()
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
    if (parts.length < 3) continue

    const additions = Number.parseInt(parts[0] ?? '0', 10)
    const deletions = Number.parseInt(parts[1] ?? '0', 10)
    const rawPath = parts.slice(2).pop()?.trim()
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
    ahead = Number.parseInt(aheadStr ?? '0', 10) || 0
    behind = Number.parseInt(behindStr ?? '0', 10) || 0
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
      } else if (line.startsWith('-') && !line.startsWith('---')) {
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
  safeHandle('git:status', async (_event, rawPath: unknown) => {
    const projectPath = projectPathSchema.parse(rawPath)
    const cached = statusCache.get(projectPath)
    if (cached && Date.now() - cached.timestamp < GIT_STATUS_CACHE_TTL) {
      return cached.result
    }
    const result = await getGitStatus(projectPath)
    statusCache.set(projectPath, { result, timestamp: Date.now() })
    return result
  })

  safeHandle('git:diff', async (_event, rawPath: unknown) => {
    const projectPath = projectPathSchema.parse(rawPath)
    return getGitDiff(projectPath)
  })
}
