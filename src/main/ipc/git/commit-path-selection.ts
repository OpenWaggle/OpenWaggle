import { lstat } from 'node:fs/promises'
import path from 'node:path'
import type { GitCommitFailure } from '@shared/types/git'
import { runGit } from './shared'
import { GIT_RAW_PATHS } from './status-constants'
import { parsePorcelain } from './status-parse'

interface SelectedRename {
  readonly from: string
  readonly to: string
  /** Whether anything still sits at the source path. */
  readonly sourceOccupied: boolean
}

type PathOccupancyResult =
  | { readonly ok: true; readonly occupied: boolean }
  | { readonly ok: false; readonly error: unknown }

type CommitPathSelectionResult =
  | { readonly ok: true; readonly paths: readonly string[] }
  | { readonly ok: false; readonly failure: GitCommitFailure }

/**
 * Expand selected rename targets to include deleted source paths.
 *
 * Git pathspec commits need both sides of a rename. We inspect the working tree here instead of relying on
 * callers to understand that detail. If something now occupies the old path, we leave it out so the commit
 * cannot include a replacement file that the user did not select.
 */
export async function resolveSelectedCommitPaths(
  projectPath: string,
  paths: readonly string[],
): Promise<CommitPathSelectionResult> {
  if (paths.length === 0) return { ok: true, paths }

  const renameResult = await resolveSelectedRenames(projectPath, paths)
  if (!renameResult.ok) return renameResult
  return { ok: true, paths: expandRenameSources(paths, renameResult.renames) }
}

/** The renames among the selected paths, read from the working tree rather than trusted from the caller. */
async function resolveSelectedRenames(
  projectPath: string,
  paths: readonly string[],
): Promise<
  | { readonly ok: true; readonly renames: readonly SelectedRename[] }
  | { readonly ok: false; readonly failure: GitCommitFailure }
> {
  const status = await runGit(projectPath, [
    ...GIT_RAW_PATHS,
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
  ])
  if (status.code !== 0) {
    const detail = status.stderr.trim()
    return {
      ok: false,
      failure: {
        ok: false,
        code: 'unknown',
        message: detail
          ? `Could not inspect selected Git paths: ${detail}`
          : 'Could not inspect selected Git paths.',
      },
    }
  }

  const selected = new Set(paths)
  const pairs: { from: string; to: string }[] = []
  for (const file of parsePorcelain(status.stdout)) {
    if (file.renamedFrom !== undefined && selected.has(file.path)) {
      pairs.push({ from: file.renamedFrom, to: file.path })
    }
  }
  const inspected = await Promise.all(
    pairs.map(async (pair) => ({
      pair,
      occupancy: await inspectPathOccupancy(path.join(projectPath, pair.from)),
    })),
  )
  const renames: SelectedRename[] = []
  for (const entry of inspected) {
    if (!entry.occupancy.ok) {
      return {
        ok: false,
        failure: {
          ok: false,
          code: 'unknown',
          message: `Could not inspect selected rename source "${entry.pair.from}": ${describeFileSystemError(entry.occupancy.error)}.`,
        },
      }
    }
    renames.push({ ...entry.pair, sourceOccupied: entry.occupancy.occupied })
  }
  return { ok: true, renames }
}

function expandRenameSources(
  paths: readonly string[],
  renames: readonly SelectedRename[],
): readonly string[] {
  if (renames.length === 0) return paths

  const selected = new Set(paths)
  for (const rename of renames) {
    if (!rename.sourceOccupied) selected.add(rename.from)
  }
  return [...selected]
}

function fileSystemErrorCode(error: unknown) {
  if (!(error instanceof Error) || !('code' in error) || typeof error.code !== 'string') {
    return null
  }
  return error.code
}

function describeFileSystemError(error: unknown) {
  const code = fileSystemErrorCode(error)
  if (code) return code
  return error instanceof Error ? error.message : 'unknown filesystem error'
}

/** Check whether anything sits at this path without following broken symlinks. */
async function inspectPathOccupancy(absolutePath: string): Promise<PathOccupancyResult> {
  try {
    await lstat(absolutePath)
    return { ok: true, occupied: true }
  } catch (error) {
    const code = fileSystemErrorCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR') return { ok: true, occupied: false }
    return { ok: false, error }
  }
}
