import type { TurnDiffFileSummary } from '@shared/types/turn-diff'

/** ADR 0034 changed-files card thresholds, mirroring the T3 Code reference. */
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

export interface TurnDiffStat {
  additions: number
  deletions: number
}

export interface TurnDiffTreeDirectoryNode {
  kind: 'directory'
  name: string
  path: string
  stat: TurnDiffStat
  children: readonly TurnDiffTreeNode[]
}

export interface TurnDiffTreeFileNode {
  kind: 'file'
  name: string
  path: string
  stat: TurnDiffStat | null
}

export type TurnDiffTreeNode = TurnDiffTreeDirectoryNode | TurnDiffTreeFileNode

interface MutableDirectoryNode {
  name: string
  path: string
  stat: TurnDiffStat
  directories: Map<string, MutableDirectoryNode>
  files: TurnDiffTreeFileNode[]
}

const SORT_LOCALE_OPTIONS: Intl.CollatorOptions = { numeric: true, sensitivity: 'base' }

function compareByName(a: { name: string }, b: { name: string }) {
  return a.name.localeCompare(b.name, undefined, SORT_LOCALE_OPTIONS)
}

function statOf(file: TurnDiffFileSummary): TurnDiffStat | null {
  if (typeof file.additions !== 'number' || typeof file.deletions !== 'number') return null
  return { additions: file.additions, deletions: file.deletions }
}

/** Single-level chain collapse: `a/b/c` with one child per level renders as one `a/b/c` row. */
function compactDirectoryNode(node: TurnDiffTreeDirectoryNode): TurnDiffTreeDirectoryNode {
  const compactedChildren = node.children.map((child) =>
    child.kind === 'directory' ? compactDirectoryNode(child) : child,
  )

  let compactedNode: TurnDiffTreeDirectoryNode = { ...node, children: compactedChildren }
  while (compactedNode.children.length === 1 && compactedNode.children[0]?.kind === 'directory') {
    const onlyChild = compactedNode.children[0]
    if (!onlyChild) break
    compactedNode = {
      kind: 'directory',
      name: `${compactedNode.name}/${onlyChild.name}`,
      path: onlyChild.path,
      stat: onlyChild.stat,
      children: onlyChild.children,
    }
  }
  return compactedNode
}

function toTreeNodes(directory: MutableDirectoryNode): readonly TurnDiffTreeNode[] {
  const subdirectories = Array.from(directory.directories.values())
    .sort(compareByName)
    .map<TurnDiffTreeDirectoryNode>((subdirectory) => ({
      kind: 'directory',
      name: subdirectory.name,
      path: subdirectory.path,
      stat: { additions: subdirectory.stat.additions, deletions: subdirectory.stat.deletions },
      children: toTreeNodes(subdirectory),
    }))
    .map((subdirectory) => compactDirectoryNode(subdirectory))
  return [...subdirectories, ...directory.files.sort(compareByName)]
}

export function summarizeTurnDiffStats(files: readonly TurnDiffFileSummary[]): TurnDiffStat {
  return files.reduce<TurnDiffStat>(
    (acc, file) => {
      const stat = statOf(file)
      if (!stat) return acc
      return {
        additions: acc.additions + stat.additions,
        deletions: acc.deletions + stat.deletions,
      }
    },
    { additions: 0, deletions: 0 },
  )
}

/** Directory-grouped file tree for the expanded changed-files card (T3 Code reference). */
export function buildTurnDiffTree(
  files: readonly TurnDiffFileSummary[],
): readonly TurnDiffTreeNode[] {
  const root: MutableDirectoryNode = {
    name: '',
    path: '',
    stat: { additions: 0, deletions: 0 },
    directories: new Map(),
    files: [],
  }

  for (const file of files) {
    const segments = pathSegments(file.path)
    const fileName = segments.at(-1)
    if (fileName === undefined) continue
    const stat = statOf(file)
    const ancestors: MutableDirectoryNode[] = []
    let currentDirectory = root
    for (const segment of segments.slice(0, -1)) {
      const existing = currentDirectory.directories.get(segment)
      if (existing) {
        currentDirectory = existing
      } else {
        const created: MutableDirectoryNode = {
          name: segment,
          path: currentDirectory.path ? `${currentDirectory.path}/${segment}` : segment,
          stat: { additions: 0, deletions: 0 },
          directories: new Map(),
          files: [],
        }
        currentDirectory.directories.set(segment, created)
        currentDirectory = created
      }
      ancestors.push(currentDirectory)
    }
    currentDirectory.files.push({ kind: 'file', name: fileName, path: segments.join('/'), stat })
    if (stat) {
      for (const ancestor of ancestors) {
        ancestor.stat.additions += stat.additions
        ancestor.stat.deletions += stat.deletions
      }
    }
  }

  return toTreeNodes(root)
}
