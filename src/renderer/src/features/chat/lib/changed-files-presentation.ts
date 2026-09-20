import type { TurnDiffFileSummary } from '@shared/types/turn-diff'

/** ADR 0033 changed-files card thresholds, mirroring the T3 Code reference. */
export const CHANGED_FILES_AUTO_EXPAND_FILE_LIMIT = 5
export const CHANGED_FILES_AUTO_EXPAND_LINE_LIMIT = 200
export const CHANGED_FILES_PREVIEW_FILE_LIMIT = 3
export const CHANGED_FILES_PREVIEW_SCOPE_LIMIT = 4

export interface ChangedFilesScopeSummary {
  readonly label: string
  readonly fileCount: number
}

function pathSegments(pathValue: string) {
  return pathValue
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment.length > 0)
}

export function changedFileName(pathValue: string): string {
  return pathSegments(pathValue).at(-1) ?? pathValue
}

function changedFileScope(pathValue: string) {
  const segments = pathSegments(pathValue)
  return segments.length > 1 ? (segments[0] ?? 'root') : 'root'
}

export function shouldAutoExpandChangedFiles(
  files: readonly TurnDiffFileSummary[],
  isLatestTurn: boolean,
): boolean {
  if (!isLatestTurn || files.length > CHANGED_FILES_AUTO_EXPAND_FILE_LIMIT) return false
  const changedLines = files.reduce((total, file) => total + file.additions + file.deletions, 0)
  return changedLines <= CHANGED_FILES_AUTO_EXPAND_LINE_LIMIT
}

export function summarizeChangedFileScopes(
  files: readonly TurnDiffFileSummary[],
  limit = CHANGED_FILES_PREVIEW_SCOPE_LIMIT,
): ChangedFilesScopeSummary[] {
  const scopes = new Map<string, { fileCount: number; firstIndex: number }>()
  files.forEach((file, index) => {
    const label = changedFileScope(file.path)
    const current = scopes.get(label)
    scopes.set(label, {
      fileCount: (current?.fileCount ?? 0) + 1,
      firstIndex: current?.firstIndex ?? index,
    })
  })

  return Array.from(scopes, ([label, scope]) => ({
    label,
    fileCount: scope.fileCount,
    firstIndex: scope.firstIndex,
  }))
    .sort(
      (left, right) =>
        right.fileCount - left.fileCount ||
        left.firstIndex - right.firstIndex ||
        left.label.localeCompare(right.label),
    )
    .slice(0, limit)
    .map(({ label, fileCount }) => ({ label, fileCount }))
}

/** One representative file per directory scope, then fill with the remaining files. */
export function selectChangedFilePreview(
  files: readonly TurnDiffFileSummary[],
  limit = CHANGED_FILES_PREVIEW_FILE_LIMIT,
): TurnDiffFileSummary[] {
  const selected: TurnDiffFileSummary[] = []
  const selectedPaths = new Set<string>()
  const selectedScopes = new Set<string>()

  for (const file of files) {
    const scope = changedFileScope(file.path)
    if (selectedScopes.has(scope)) continue
    selected.push(file)
    selectedPaths.add(file.path)
    selectedScopes.add(scope)
    if (selected.length === limit) return selected
  }

  for (const file of files) {
    if (selectedPaths.has(file.path)) continue
    selected.push(file)
    if (selected.length === limit) break
  }

  return selected
}

/** Highest turn index across the session's checkpoints (latest settled turn). */
export function latestTurnIndex(
  turns: ReadonlyMap<string, { readonly turnIndex: number }>,
): number {
  let latest = -1
  for (const turn of turns.values()) {
    if (turn.turnIndex > latest) latest = turn.turnIndex
  }
  return latest
}
