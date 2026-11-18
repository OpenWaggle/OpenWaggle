import type { GitFileDiff } from '@shared/types/git'
import type { TurnDiffFileSummary } from '@shared/types/turn-diff'

/**
 * Parse a unified diff into per-file additions/deletions summaries, sorted by path.
 *
 * Self-contained by design: counts +/- hunk lines and ignores the +++/--- file
 * headers, so it needs no git invocation and no diff library.
 */
export function parseTurnDiffFilesFromUnifiedDiff(diff: string) {
  const normalized = diff.replace(/\r\n/g, '\n').trim()
  const files: TurnDiffFileSummary[] = []
  if (normalized.length === 0) return files

  const chunks = normalized.split(/^diff --git /m).filter((chunk) => chunk.trim().length > 0)

  for (const chunk of chunks) {
    const summary = summarizeChunk(chunk)
    if (summary) files.push(summary)
  }

  const sorted: TurnDiffFileSummary[] = files.toSorted((left, right) =>
    left.path.localeCompare(right.path),
  )
  return sorted
}

export function sumInsertions(files: readonly TurnDiffFileSummary[]) {
  return files.reduce((total, file) => total + file.additions, 0)
}

export function sumDeletions(files: readonly TurnDiffFileSummary[]) {
  return files.reduce((total, file) => total + file.deletions, 0)
}

/**
 * Split a unified diff into per-file GitFileDiff entries (path + that file's
 * diff block + counts), so a Turn diff can render in the file-oriented panel.
 */
export function splitUnifiedDiffIntoFileDiffs(diff: string) {
  const normalized = diff.replace(/\r\n/g, '\n').trim()
  const files: GitFileDiff[] = []
  if (normalized.length === 0) return files

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
  const sorted: GitFileDiff[] = files.toSorted((left, right) => left.path.localeCompare(right.path))
  return sorted
}

function summarizeChunk(chunk: string) {
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

function resolveChunkPath(lines: readonly string[]) {
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
