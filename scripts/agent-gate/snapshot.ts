/**
 * What a tool call changed, from `git status` snapshots taken before and after it. A snapshot maps
 * each dirty or untracked file to a fingerprint (status, size and modification time), so an edit
 * made from the shell shows up as well as one made by the edit or write tools. A file that leaves
 * the dirty set changed too (reverted or committed), and a commit made during the call adds the
 * files it touched.
 */
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { type RunProcess, git } from './run-process'

export interface WorkspaceSnapshot {
  readonly head: string
  /** Dirty or untracked file (repository-relative) to its fingerprint. */
  readonly files: ReadonlyMap<string, string>
}

const GIT_TIMEOUT_MS = 15_000
// Porcelain v1 entries are `XY path`.
const STATUS_PATH_START = 3
const STATUS_CODE_END = 2
const DELETED = 'deleted'

function nulSeparated(output: string) {
  return output.split('\0').filter((entry) => entry.length > 0)
}

export async function repositoryRoot(run: RunProcess, cwd: string) {
  return (await git(run, cwd, ['rev-parse', '--show-toplevel'], GIT_TIMEOUT_MS))?.trim()
}

async function fingerprint(root: string, file: string, status: string) {
  try {
    const info = await stat(path.join(root, file), { bigint: true })
    return `${status}:${info.size}:${info.mtimeNs}`
  } catch {
    return `${status}:${DELETED}`
  }
}

/** The dirty files of the repository at `root`, or undefined when git cannot answer. */
export async function takeSnapshot(
  run: RunProcess,
  root: string,
): Promise<WorkspaceSnapshot | undefined> {
  const [head, status] = await Promise.all([
    git(run, root, ['rev-parse', 'HEAD'], GIT_TIMEOUT_MS),
    git(
      run,
      root,
      ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'],
      GIT_TIMEOUT_MS,
    ),
  ])
  if (status === undefined) return undefined
  const entries = nulSeparated(status).map((entry) => ({
    code: entry.slice(0, STATUS_CODE_END),
    file: entry.slice(STATUS_PATH_START),
  }))
  const prints = await Promise.all(
    entries.map(async ({ code, file }) => [file, await fingerprint(root, file, code)] as const),
  )
  return { head: head?.trim() ?? '', files: new Map(prints) }
}

/** Files whose fingerprint differs between two snapshots, in either direction. */
export function changedBetween(before: WorkspaceSnapshot, after: WorkspaceSnapshot) {
  const files = new Set([...before.files.keys(), ...after.files.keys()])
  return [...files].filter((file) => before.files.get(file) !== after.files.get(file)).sort()
}

/** Files that commits between two heads touched; empty when the head did not move. */
export async function committedBetween(
  run: RunProcess,
  root: string,
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
) {
  if (before.head === after.head || before.head === '' || after.head === '') return []
  const output = await git(
    run,
    root,
    ['diff', '--name-only', '-z', '--no-renames', before.head, after.head],
    GIT_TIMEOUT_MS,
  )
  return nulSeparated(output ?? '')
}

/** Every change a tool call made, given the snapshots around it. */
export async function changesBetween(
  run: RunProcess,
  root: string,
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
) {
  const committed = await committedBetween(run, root, before, after)
  return [...new Set([...changedBetween(before, after), ...committed])].sort()
}
