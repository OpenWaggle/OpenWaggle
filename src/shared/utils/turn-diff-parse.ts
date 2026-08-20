import type { GitFileDiff } from '@shared/types/git'
import type { TurnDiffFileSummary } from '@shared/types/turn-diff'

/**
 * Parse a unified diff into per-file additions/deletions summaries, sorted by path.
 *
 * Self-contained by design: counts +/- hunk lines and ignores the +++/--- file
 * headers, so it needs no git invocation and no diff library.
 */
export function parseTurnDiffFilesFromUnifiedDiff(diff: string): TurnDiffFileSummary[] {
  const normalized = diff.replace(/\r\n/g, '\n').trim()
  if (normalized.length === 0) return []

  const files: TurnDiffFileSummary[] = []
  const chunks = normalized.split(/^diff --git /m).filter((chunk) => chunk.trim().length > 0)

  for (const chunk of chunks) {
    const summary = summarizeChunk(chunk)
    if (summary) files.push(summary)
  }

  return files.toSorted((left, right) => left.path.localeCompare(right.path))
}

export function sumInsertions(files: readonly TurnDiffFileSummary[]): number {
  return files.reduce((total, file) => total + file.additions, 0)
}

export function sumDeletions(files: readonly TurnDiffFileSummary[]): number {
  return files.reduce((total, file) => total + file.deletions, 0)
}

/**
 * Split a unified diff into per-file GitFileDiff entries (path + that file's
 * diff block + counts), so a Turn diff can render in the file-oriented panel.
 */
export function splitUnifiedDiffIntoFileDiffs(diff: string): GitFileDiff[] {
  const normalized = diff.replace(/\r\n/g, '\n').trim()
  if (normalized.length === 0) return []

  const files: GitFileDiff[] = []
  const chunks = normalized.split(/^diff --git /m).filter((chunk) => chunk.trim().length > 0)
  for (const chunk of chunks) {
    const summary = summarizeChunk(chunk)
    if (summary) {
      files.push({
        path: summary.path,
        diff: `diff --git ${chunk.replace(/\n+$/, '')}\n`,
        additions: summary.additions,
        deletions: summary.deletions,
      })
    }
  }
  return files.toSorted((left, right) => left.path.localeCompare(right.path))
}

function summarizeChunk(chunk: string): TurnDiffFileSummary | null {
  const lines = chunk.split('\n')
  const path = resolveChunkPath(lines)
  if (!path) return null

  let additions = 0
  let deletions = 0
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1
    if (line.startsWith('-') && !line.startsWith('---')) deletions += 1
  }
  return { path, additions, deletions }
}

function resolveChunkPath(lines: readonly string[]): string | null {
  for (const line of lines) {
    const added = /^\+\+\+ b\/(.+)$/.exec(line)
    if (added?.[1] && added[1] !== '/dev/null') return added[1]
    const removed = /^--- a\/(.+)$/.exec(line)
    if (removed?.[1] && removed[1] !== '/dev/null') return removed[1]
  }
  const header = lines[0] ?? ''
  const headerMatch = / b\/(.+)$/.exec(header)
  return headerMatch?.[1] ?? null
}
