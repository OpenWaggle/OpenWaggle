import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runGit } from './shared'
import { GIT_RAW_PATHS } from './status-constants'
import { type LineStats, type ParsedPorcelainEntry, parseNumstat } from './status-parse'

async function listUntrackedPaths(projectPath: string) {
  const result = await runGit(projectPath, [
    ...GIT_RAW_PATHS,
    'ls-files',
    '--others',
    '--exclude-standard',
    '--full-name',
    '-z',
    '--',
    ':/',
  ])
  return result.code === 0 ? result.stdout.split('\0').filter(Boolean) : []
}

function expandUntrackedDirectories(
  porcelain: readonly ParsedPorcelainEntry[],
  untrackedPaths: readonly string[],
) {
  const expanded = porcelain.filter(
    (entry) =>
      entry.status !== 'untracked' ||
      !entry.path.endsWith('/') ||
      !untrackedPaths.some((untrackedPath) => untrackedPath.startsWith(entry.path)),
  )
  const knownPaths = new Set(expanded.map((entry) => entry.path))
  for (const untrackedPath of untrackedPaths) {
    if (knownPaths.has(untrackedPath)) continue
    expanded.push({
      path: untrackedPath,
      status: 'untracked',
      staged: false,
      unstaged: true,
    })
  }
  return expanded
}

async function loadUntrackedNumstat(projectPath: string, paths: readonly string[]) {
  if (paths.length === 0) return new Map<string, LineStats>()
  const scratchRoot = await mkdtemp(path.join(tmpdir(), 'openwaggle-untracked-index-'))
  const scratchIndex = path.join(scratchRoot, 'index')
  const options = { env: { GIT_INDEX_FILE: scratchIndex } }
  try {
    // A scratch index lets Git calculate exact text/binary numstat for every untracked file in one
    // diff. The former no-index loop spawned one child per file, making status and the commit dialog
    // progressively slower on generated trees. Seed from HEAD so tracked files retain their normal
    // identity; an unborn repository starts from an empty index.
    const seeded = await runGit(projectPath, ['read-tree', 'HEAD'], options)
    if (seeded.code !== 0) {
      const emptied = await runGit(projectPath, ['read-tree', '--empty'], options)
      if (emptied.code !== 0) return new Map<string, LineStats>()
    }
    const added = await runGit(
      projectPath,
      ['add', '--intent-to-add', '--all', '--', ':/'],
      options,
    )
    if (added.code !== 0) return new Map<string, LineStats>()
    const diff = await runGit(
      projectPath,
      [...GIT_RAW_PATHS, 'diff', '--numstat', '-z', '--no-renames'],
      options,
    )
    if (diff.code !== 0) return new Map<string, LineStats>()
    const untracked = new Set(paths)
    return new Map([...parseNumstat(diff.stdout)].filter(([filePath]) => untracked.has(filePath)))
  } finally {
    await rm(scratchRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function resolveUntrackedStatus(
  projectPath: string,
  porcelain: readonly ParsedPorcelainEntry[],
): Promise<{
  readonly porcelain: readonly ParsedPorcelainEntry[]
  readonly numstat: ReadonlyMap<string, LineStats>
}> {
  if (!porcelain.some((entry) => entry.status === 'untracked')) {
    return { porcelain, numstat: new Map<string, LineStats>() }
  }
  const paths = await listUntrackedPaths(projectPath)
  return {
    porcelain: expandUntrackedDirectories(porcelain, paths),
    numstat: await loadUntrackedNumstat(projectPath, paths),
  }
}
