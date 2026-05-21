import { match } from '@diegogbrisa/ts-match'
import type { GitChangedFile, GitFileDiff, GitFileStatus } from '@shared/types/git'
import { stripSurroundingQuotes } from './shared'
import {
  GIT_NUMSTAT_PATH_OFFSET,
  GIT_PARSE_INT_RADIX,
  GIT_STATUS_CODE_WIDTH,
  GIT_STATUS_PATH_OFFSET,
} from './status-constants'

interface ParsedPorcelainEntry {
  readonly path: string
  readonly status: GitFileStatus
  readonly staged: boolean
}

interface LineStats {
  readonly additions: number
  readonly deletions: number
}

export function normalizeGitPath(rawPath: string) {
  const trimmed = rawPath.trim()
  if (!trimmed) return ''

  const braceNormalized = trimmed.replaceAll(/\{([^{}]*?) => ([^{}]*?)\}/g, '$2')
  if (braceNormalized !== trimmed) return stripSurroundingQuotes(braceNormalized.trim())

  const renameTarget = findPlainRenameTarget(trimmed)
  return stripSurroundingQuotes(renameTarget ?? trimmed)
}

export function parsePorcelain(stdout: string) {
  const entries: ParsedPorcelainEntry[] = []

  for (const line of nonEmptyTrimmedLines(stdout)) {
    const entry = parsePorcelainLine(line)
    if (entry) entries.push(entry)
  }

  return entries
}

export function parseNumstat(stdout: string) {
  const result = new Map<string, LineStats>()

  for (const line of nonEmptyTrimmedLines(stdout)) {
    const parsed = parseNumstatLine(line)
    if (parsed) result.set(parsed.path, parsed.stats)
  }

  return result
}

export function buildChangedFiles(
  porcelainEntries: readonly ParsedPorcelainEntry[],
  numstat: ReadonlyMap<string, LineStats>,
) {
  const byPath = new Map<string, ParsedPorcelainEntry>()
  for (const entry of porcelainEntries) byPath.set(entry.path, entry)
  for (const path of numstat.keys()) {
    if (!byPath.has(path)) byPath.set(path, { path, status: 'modified', staged: false })
  }

  return [...byPath.values()]
    .map((entry) => buildChangedFile(entry, numstat.get(entry.path)))
    .sort((a, b) => a.path.localeCompare(b.path))
}

export function parseUnifiedDiff(stdout: string) {
  const files: GitFileDiff[] = []
  const chunks = stdout.split(/^diff --git /m).filter(Boolean)

  for (const chunk of chunks) {
    const parsed = parseUnifiedDiffChunk(chunk)
    if (parsed) files.push(parsed)
  }

  return files
}

export function mergeDiffsByPath(diffs: readonly GitFileDiff[]) {
  const merged = new Map<string, GitFileDiff>()

  for (const diff of diffs) {
    const existing = merged.get(diff.path)
    merged.set(diff.path, existing ? mergeDiff(existing, diff) : diff)
  }

  return [...merged.values()].sort((a, b) => a.path.localeCompare(b.path))
}

function nonEmptyTrimmedLines(stdout: string) {
  return stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
}

function findPlainRenameTarget(trimmed: string) {
  for (const delimiter of [' => ', ' -> ']) {
    if (!trimmed.includes(delimiter)) continue
    const candidate = trimmed.split(delimiter).pop()?.trim()
    if (candidate) return candidate
  }
  return null
}

function mapStatusCode(code: string): GitFileStatus {
  return match(code)
    .with('M', () => 'modified' as const)
    .with('A', () => 'added' as const)
    .with('D', () => 'deleted' as const)
    .with('R', () => 'renamed' as const)
    .with('C', () => 'copied' as const)
    .with('?', () => 'untracked' as const)
    .otherwise(() => 'unknown' as const)
}

function parsePorcelainLine(line: string) {
  if (line.length < GIT_STATUS_CODE_WIDTH) return null
  const x = line[0] ?? ' '
  const y = line[1] ?? ' '
  return {
    path: normalizeGitPath(line.slice(GIT_STATUS_PATH_OFFSET).trim()),
    status: mapStatusCode(x === '?' && y === '?' ? '?' : y !== ' ' ? y : x),
    staged: x !== ' ' && x !== '?',
  }
}

function parseNumstatLine(line: string) {
  const parts = line.split('\t')
  if (parts.length < GIT_STATUS_CODE_WIDTH) return null

  const rawPath = parts.slice(GIT_NUMSTAT_PATH_OFFSET).pop()?.trim()
  const path = rawPath ? normalizeGitPath(rawPath) : ''
  if (!path) return null

  return {
    path,
    stats: {
      additions: parseLineCount(parts[0]),
      deletions: parseLineCount(parts[1]),
    },
  }
}

function parseLineCount(value: string | undefined) {
  const parsed = Number.parseInt(value ?? '0', GIT_PARSE_INT_RADIX)
  return Number.isFinite(parsed) ? parsed : 0
}

function buildChangedFile(entry: ParsedPorcelainEntry, lineStats: LineStats | undefined) {
  return {
    path: entry.path,
    status: entry.status,
    staged: entry.staged,
    additions: lineStats?.additions ?? 0,
    deletions: lineStats?.deletions ?? 0,
  } satisfies GitChangedFile
}

function parseUnifiedDiffChunk(chunk: string) {
  const lines = chunk.split('\n')
  const filePath = getDiffChunkPath(lines[0] ?? '')
  if (!filePath) return null

  const stats = countDiffStats(lines.slice(1))
  return {
    path: filePath,
    diff: `diff --git ${chunk}`,
    additions: stats.additions,
    deletions: stats.deletions,
  }
}

function getDiffChunkPath(header: string) {
  return / b\/(.+)$/.exec(header)?.[1] ?? header.trim()
}

function countDiffStats(lines: readonly string[]) {
  let additions = 0
  let deletions = 0

  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++
    if (line.startsWith('-') && !line.startsWith('---')) deletions++
  }

  return { additions, deletions }
}

function mergeDiff(existing: GitFileDiff, diff: GitFileDiff) {
  return {
    path: diff.path,
    diff: `${existing.diff}\n${diff.diff}`,
    additions: existing.additions + diff.additions,
    deletions: existing.deletions + diff.deletions,
  }
}
