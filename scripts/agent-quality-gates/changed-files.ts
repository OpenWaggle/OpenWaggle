/**
 * Which files an agent changed during one run. A snapshot at the start records `HEAD` and the
 * content hash of every file that was already dirty; at the end, a file counts as changed when
 * its content differs from that start state, whether the agent edited it with a tool, from the
 * shell, or committed it. Files that were dirty before the run and left alone are not counted.
 */
import type { RunProcess } from './process'

export interface WorkspaceSnapshot {
  readonly root: string
  readonly head: string
  /** Content hash of each file that differed from `head` at the start; `''` for a deleted file. */
  readonly dirty: ReadonlyMap<string, string>
}

const GIT_TIMEOUT_MS = 30_000
// Status entries are `XY path`; a rename adds the old path as its own NUL-terminated entry.
const STATUS_PATH_START = 3
const LS_TREE_HASH = /^\d+ blob (?<hash>[0-9a-f]+)\t(?<file>.+)$/s

async function git(run: RunProcess, cwd: string, args: readonly string[], input?: string) {
  const result = await run('git', args, {
    cwd,
    timeoutMs: GIT_TIMEOUT_MS,
    ...(input === undefined ? {} : { input }),
  })
  return result.code === 0 ? result.stdout : undefined
}

function nulSeparated(output: string) {
  return output.split('\0').filter((entry) => entry.length > 0)
}

/** The repository's state at the start of a run, or undefined outside a repository with commits. */
export async function takeSnapshot(
  run: RunProcess,
  cwd: string,
): Promise<WorkspaceSnapshot | undefined> {
  const root = (await git(run, cwd, ['rev-parse', '--show-toplevel']))?.trim()
  const head =
    root === undefined ? undefined : (await git(run, root, ['rev-parse', 'HEAD']))?.trim()
  if (root === undefined || head === undefined) {
    return undefined
  }
  const status = await git(run, root, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--no-renames',
  ])
  if (status === undefined) {
    return undefined
  }
  const files = nulSeparated(status).map((entry) => entry.slice(STATUS_PATH_START))
  return { root, head, dirty: await contentHashes(run, root, files) }
}

/**
 * Files whose content differs from the snapshot, relative to the repository root. A file deleted
 * since the snapshot counts, so the gate sees a deleted test.
 */
export async function changedFiles(
  run: RunProcess,
  snapshot: WorkspaceSnapshot,
): Promise<string[]> {
  const { root, head } = snapshot
  const [diff, untracked] = await Promise.all([
    git(run, root, ['diff', '--name-only', '-z', '--no-renames', head]),
    git(run, root, ['ls-files', '--others', '--exclude-standard', '-z']),
  ])
  if (diff === undefined || untracked === undefined) {
    return []
  }
  const candidates = [
    ...new Set([...nulSeparated(diff), ...nulSeparated(untracked), ...snapshot.dirty.keys()]),
  ]
  if (candidates.length === 0) {
    return []
  }
  const [now, atHead] = await Promise.all([
    contentHashes(run, root, candidates),
    headHashes(run, root, head, candidates),
  ])
  return candidates.filter((file) => {
    const current = now.get(file) ?? ''
    const before = snapshot.dirty.get(file) ?? atHead.get(file) ?? ''
    return current !== before
  })
}

/** The blob hash of each existing file's working-tree content; deleted files map to `''`. */
async function contentHashes(run: RunProcess, root: string, files: readonly string[]) {
  const hashes = new Map<string, string>(files.map((file) => [file, '']))
  if (files.length === 0) {
    return hashes
  }
  // `--stdin-paths` stops at the first missing file, so hash one path per line and keep order.
  const output = await git(run, root, ['hash-object', '--stdin-paths'], `${files.join('\n')}\n`)
  if (output !== undefined) {
    const lines = output.split('\n')
    files.forEach((file, index) => hashes.set(file, lines[index] ?? ''))
    return hashes
  }
  // One of them is missing: fall back to hashing files one by one.
  await Promise.all(
    files.map(async (file) => {
      const single = await git(run, root, ['hash-object', '--', file])
      hashes.set(file, single?.trim() ?? '')
    }),
  )
  return hashes
}

async function headHashes(run: RunProcess, root: string, head: string, files: readonly string[]) {
  const output = await git(run, root, ['ls-tree', '-r', '-z', head, '--', ...files])
  const hashes = new Map<string, string>()
  for (const entry of nulSeparated(output ?? '')) {
    const groups = LS_TREE_HASH.exec(entry)?.groups
    if (groups?.['file'] !== undefined && groups['hash'] !== undefined) {
      hashes.set(groups['file'], groups['hash'])
    }
  }
  return hashes
}
