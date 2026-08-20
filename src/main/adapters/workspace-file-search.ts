import type { WorkspaceFileEntry } from '@shared/types/workspace-files'

const MAX_INITIAL_RECENT_FILES = 20
const BASENAME_PREFIX_SCORE = 5
const BASENAME_CONTAINS_SCORE = 20
const PATH_CONTAINS_SCORE = 40
const BASENAME_SUBSEQUENCE_SCORE = 80
const PATH_SUBSEQUENCE_SCORE = 120

const recentFilesByProject = new Map<string, string[]>()

function subsequenceScore(value: string, query: string) {
  let queryIndex = 0
  let firstIndex = -1
  let lastIndex = -1
  for (
    let valueIndex = 0;
    valueIndex < value.length && queryIndex < query.length;
    valueIndex += 1
  ) {
    if (value[valueIndex] !== query[queryIndex]) continue
    if (firstIndex < 0) firstIndex = valueIndex
    lastIndex = valueIndex
    queryIndex += 1
  }
  if (queryIndex !== query.length) return null
  return (firstIndex < 0 ? 0 : firstIndex) + Math.max(0, lastIndex - firstIndex - query.length)
}

function fileSearchScore(entry: WorkspaceFileEntry, rawQuery: string) {
  const query = rawQuery
    .trim()
    .toLowerCase()
    .replace(/^[@./]+/, '')
    .replaceAll(/\s/g, '')
  if (!query) return 0
  const basename = entry.basename.toLowerCase()
  const pathValue = entry.path.toLowerCase()
  if (basename === query) return 0
  if (basename.startsWith(query)) return BASENAME_PREFIX_SCORE + basename.length - query.length
  const basenameIndex = basename.indexOf(query)
  if (basenameIndex >= 0) return BASENAME_CONTAINS_SCORE + basenameIndex
  const pathIndex = pathValue.indexOf(query)
  if (pathIndex >= 0) return PATH_CONTAINS_SCORE + pathIndex
  const basenameSubsequence = subsequenceScore(basename, query)
  if (basenameSubsequence !== null) return BASENAME_SUBSEQUENCE_SCORE + basenameSubsequence
  const pathSubsequence = subsequenceScore(pathValue, query)
  return pathSubsequence === null ? null : PATH_SUBSEQUENCE_SCORE + pathSubsequence
}

function recentRank(projectRoot: string, relativePath: string) {
  const index = recentFilesByProject.get(projectRoot)?.indexOf(relativePath) ?? -1
  return index < 0 ? Number.MAX_SAFE_INTEGER : index
}

export function searchIndexedFiles(
  projectRoot: string,
  entries: readonly WorkspaceFileEntry[],
  query: string,
  limit: number,
) {
  return entries
    .flatMap((entry) => {
      const score = fileSearchScore(entry, query)
      return score === null ? [] : [{ entry, score, recent: recentRank(projectRoot, entry.path) }]
    })
    .sort((left, right) => {
      if (!query.trim() && left.recent !== right.recent) return left.recent - right.recent
      return left.score - right.score || left.entry.path.localeCompare(right.entry.path)
    })
    .slice(0, limit)
    .map((result) => result.entry)
}

export function rememberWorkspaceFile(projectRoot: string, relativePath: string) {
  const current = recentFilesByProject.get(projectRoot) ?? []
  recentFilesByProject.set(
    projectRoot,
    [relativePath, ...current.filter((entry) => entry !== relativePath)].slice(
      0,
      MAX_INITIAL_RECENT_FILES,
    ),
  )
}
