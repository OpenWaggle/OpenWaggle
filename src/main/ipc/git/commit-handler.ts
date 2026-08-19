import { lstat } from 'node:fs/promises'
import path from 'node:path'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import type { GitCommitFailure, GitCommitPayload, GitCommitResult } from '@shared/types/git'
import * as Effect from 'effect/Effect'
import { typedHandle } from '../typed-ipc'
import {
  currentHead,
  findOmittedPaths,
  stagedPaths,
  undoIncompleteCommit,
} from './commit-verification'
import { isGitRepository, projectPathSchema, runGit } from './shared'
import { GIT_LITERAL_PATHS, GIT_RAW_PATHS } from './status-constants'
import { invalidateGitStatusCache } from './status-handler'
import { parsePorcelain } from './status-parse'
import { invalidateVcsStatus } from './vcs-status-cache'
import { resolveRepositoryRoot } from './working-tree-service'

function commitFailure(code: GitCommitFailure['code'], message: string): GitCommitFailure {
  return { ok: false, code, message }
}

function mapCommitFailure(stderr: string): GitCommitFailure {
  const message = stderr.trim()
  const lower = message.toLowerCase()

  /*
   * A case-only rename cannot be committed through a pathspec at all. On a case-insensitive filesystem git
   * refuses with "will not add file alias", because a pathspec commit rebuilds those entries from the working
   * tree and finds the other spelling already in the index. Committing the whole index would work but would
   * sweep in anything the user staged themselves, so the honest response is to say what happened rather than
   * pass a raw fatal through as an unknown failure.
   */
  if (lower.includes('will not add file alias')) {
    return commitFailure(
      'case-only-rename',
      'Git cannot commit a rename that only changes letter case on this filesystem. Commit it from the command line, or rename through a temporary name.',
    )
  }
  if (lower.includes('not a git repository')) {
    return commitFailure('not-git-repo', 'Selected folder is not a Git repository.')
  }
  if (
    lower.includes('nothing to commit') ||
    lower.includes('no changes added to commit') ||
    lower.includes('nothing added to commit')
  ) {
    return commitFailure('nothing-to-commit', 'No changes available to commit.')
  }
  if (lower.includes('merge_head exists') || lower.includes('you have not concluded your merge')) {
    return commitFailure('merge-in-progress', 'Resolve the merge in progress before committing.')
  }

  return commitFailure('unknown', message || 'Git commit failed.')
}

export async function commitGit(
  rawProjectPath: string,
  payload: GitCommitPayload,
): Promise<GitCommitResult> {
  const message = payload.message.trim()
  const preflightFailure = await validateCommitPreflight(rawProjectPath, message)
  if (preflightFailure) return preflightFailure

  /*
   * Everything a correct commit needs is settled here, once, because there is more than one way into it -
   * the diff panel's stacked action and the header's Commit dialog - and each got a different subset right.
   *
   * The root, because the paths are repository-relative: that is what `git status --porcelain` reports and
   * what every caller passes on, so running from an opened subdirectory resolved them against that
   * subdirectory and the commit died on a pathspec that "did not match any files".
   *
   * The rename sources, because a commit that names only a rename's target keeps both files and leaves the
   * deletion staged. Expanded from the working tree rather than trusted from the caller, so a caller that
   * does not know about renames cannot get this wrong.
   */
  const projectPath = (await resolveRepositoryRoot(rawProjectPath)) ?? rawProjectPath
  const renames = await resolveSelectedRenames(projectPath, payload.paths)
  const paths = expandRenameSources(payload.paths, renames)

  const stageFailure = await stageCommitPaths(projectPath, paths)
  if (stageFailure) return stageFailure

  // Recorded before the commit, so what the commit actually did can be compared against what was asked.
  const [stagedBefore, previousHead] = await Promise.all([
    stagedPaths(projectPath),
    currentHead(projectPath),
  ])

  const commitArgs = [...GIT_LITERAL_PATHS, 'commit', '-m', message]
  if (payload.amend) {
    commitArgs.push('--amend')
  }
  if (paths.length > 0) {
    commitArgs.push('--', ...paths)
  }

  const commitResult = await runGit(projectPath, commitArgs)
  if (commitResult.code !== 0) {
    return mapCommitFailure(`${commitResult.stderr}\n${commitResult.stdout}`)
  }

  const omitted = await findOmittedPaths(projectPath, { intended: paths, stagedBefore })
  if (omitted) return await undoIncompleteCommit(projectPath, { omitted, previousHead })

  const hashResult = await runGit(projectPath, ['rev-parse', 'HEAD'])
  const commitHash = hashResult.code === 0 ? hashResult.stdout.trim() : ''
  const summary = commitResult.stdout.trim().split('\n')[0] ?? 'Commit created.'

  return {
    ok: true,
    commitHash,
    summary,
  }
}

async function validateCommitPreflight(projectPath: string, message: string) {
  if (!message) {
    return commitFailure('empty-message', 'Commit message is required.')
  }
  if (!(await isGitRepository(projectPath))) {
    return commitFailure('not-git-repo', 'Selected folder is not a Git repository.')
  }

  const mergeCheck = await runGit(projectPath, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
  return mergeCheck.code === 0
    ? commitFailure('merge-in-progress', 'Resolve the merge in progress before committing.')
    : null
}

interface SelectedRename {
  readonly from: string
  readonly to: string
  /** Whether anything still sits at the source path - see {@link expandRenameSources}. */
  readonly sourceOccupied: boolean
}

/** The renames among the selected paths, read from the working tree rather than trusted from the caller. */
async function resolveSelectedRenames(
  projectPath: string,
  paths: readonly string[],
): Promise<readonly SelectedRename[]> {
  if (paths.length === 0) return []

  const status = await runGit(projectPath, [
    ...GIT_RAW_PATHS,
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ])
  if (status.code !== 0) return []

  const selected = new Set(paths)
  const pairs: { from: string; to: string }[] = []
  for (const file of parsePorcelain(status.stdout)) {
    if (file.renamedFrom !== undefined && selected.has(file.path)) {
      pairs.push({ from: file.renamedFrom, to: file.path })
    }
  }
  // Independent reads, so asked together.
  const occupied = await Promise.all(
    pairs.map((pair) => pathExists(path.join(projectPath, pair.from))),
  )
  return pairs.map((pair, index) => ({ ...pair, sourceOccupied: occupied[index] === true }))
}

/**
 * Add each rename's source beside its target, unless something now occupies that path.
 *
 * A commit that names only the target keeps both files and leaves the deletion staged, so the source belongs
 * in the commit. Read from the working tree rather than trusted from the caller, so a caller that knows
 * nothing about renames still commits one correctly.
 *
 * The occupancy check also settles copies, which `git status` reports with the same `old -> new` shape when
 * `status.renames` is set to `copies`. A copy's source is not deleted, so it is still there to be found, and
 * committing it would commit a file the user did not select.
 *
 * The occupancy check is not a nicety. `git commit -- <paths>` commits the *working tree* content of those
 * paths, so if the user has since created a new file - or a directory - where the rename started, naming that
 * path commits whatever is there now: verified that a rename plus an unrelated new file at the old name
 * committed the new file, which the user never selected. When the path is occupied there is no deletion to
 * express, and the honest commit is the target alone.
 */
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

/**
 * Whether the only complaint is that a pathspec matched nothing.
 *
 * That is not a failure for this purpose: it means the path is already staged, as a rename's source is.
 */
function isUnmatchedPathspec(stderr: string) {
  return /did not match any files/u.test(stderr)
}

/**
 * Whether anything at all sits at this path, without following it.
 *
 * `lstat`, not `stat`: a broken symlink is something the user put there, and `stat` reports it as absent - so
 * the rename source was expanded into the commit and the symlink committed unselected.
 */
async function pathExists(absolutePath: string) {
  try {
    await lstat(absolutePath)
    return true
  } catch {
    return false
  }
}

async function stageCommitPaths(projectPath: string, paths: readonly string[]) {
  if (paths.length === 0) return null

  /*
   * `-A`, so removals count as changes to stage, and one path at a time.
   *
   * Two real git behaviours force this shape. A plain `git add -- <paths>` refuses a path that is gone from
   * disk, which is true of a deletion and of a rename's source, so `-A` is required. And a path can be in
   * the commit set while matching nothing for `add`: an *already staged* rename has its source gone from
   * both disk and index, yet the source must stay in the commit pathspec or the commit keeps both files and
   * leaves the deletion staged. Batching makes that fatal - `add -A -- kept.txt moved.txt` exits 128 -
   * whereas per-path staging lets the unmatched entry be skipped while everything else is staged.
   */
  for (const singlePath of paths) {
    const addResult = await runGit(projectPath, [
      ...GIT_LITERAL_PATHS,
      'add',
      '-A',
      '--',
      singlePath,
    ])
    if (addResult.code === 0) continue
    if (isUnmatchedPathspec(addResult.stderr)) continue
    return mapCommitFailure(addResult.stderr)
  }
  return null
}

const commitPayloadSchema = Schema.Struct({
  message: Schema.String,
  amend: Schema.Boolean,
  paths: Schema.Array(Schema.String),
})

export function registerGitCommitHandlers(): void {
  typedHandle('git:commit', (_event, rawPath: unknown, rawPayload: unknown) =>
    Effect.gen(function* () {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
      const payload = decodeUnknownOrThrow(commitPayloadSchema, rawPayload)
      const result = yield* Effect.promise(() => commitGit(projectPath, payload))
      if (result.ok) {
        invalidateGitStatusCache(projectPath)
        invalidateVcsStatus(projectPath)
      }
      return result
    }),
  )
}
