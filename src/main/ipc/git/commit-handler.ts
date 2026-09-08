import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { SessionId } from '@shared/types/brand'
import type { GitCommitFailure, GitCommitPayload, GitCommitResult } from '@shared/types/git'
import * as Effect from 'effect/Effect'
import { resolveSessionOutputOccurrenceContext } from '../../application/session-resource-recording'
import { typedHandle } from '../typed-ipc'
import { resolveCommittedHead } from './commit-head-resolution'
import {
  encodeSelectedGitPaths,
  selectedGitPathsSchema,
  validateSelectedGitPaths,
} from './commit-path-contract'
import { resolveSelectedCommitPaths } from './commit-path-selection'
import { withGitMutationLock } from './mutation-lock'
import { verifySessionWorkingPath } from './session-working-path'
import { isGitRepository, projectPathSchema, runGit } from './shared'
import { recordSessionCommitOutput } from './stacked-action-output-recording'
import { GIT_LITERAL_PATHS } from './status-constants'
import { invalidateGitStatusCache } from './status-handler'
import { invalidateVcsStatus } from './vcs-status-cache'
import { resolveRepositoryRoot } from './working-tree-service'

const COMMIT_HASH_UNAVAILABLE_MESSAGE =
  'The commit was created, but Git did not return its full hash. OpenWaggle did not add an Output for it. Do not repeat the commit; refresh Git status before continuing.'

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

type PreparedCommitPaths =
  | {
      readonly ok: true
      readonly includeUnstaged: boolean
      readonly paths: readonly string[]
    }
  | { readonly ok: false; readonly failure: GitCommitFailure }

async function prepareCommitPaths(
  projectPath: string,
  payload: GitCommitPayload,
): Promise<PreparedCommitPaths> {
  const inputPathFailure = validateSelectedGitPaths(payload.paths)
  if (inputPathFailure) {
    return { ok: false, failure: commitFailure('unknown', inputPathFailure) }
  }

  const includeUnstaged = payload.includeUnstaged !== false
  if (!includeUnstaged) return { ok: true, includeUnstaged, paths: payload.paths }

  const pathResult = await resolveSelectedCommitPaths(projectPath, payload.paths)
  if (!pathResult.ok) return pathResult
  const expandedPathFailure = validateSelectedGitPaths(pathResult.paths)
  return expandedPathFailure
    ? { ok: false, failure: commitFailure('unknown', expandedPathFailure) }
    : { ok: true, includeUnstaged, paths: pathResult.paths }
}

export async function commitGit(
  rawProjectPath: string,
  payload: GitCommitPayload,
): Promise<GitCommitResult> {
  const message = payload.message.trim()

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
  /*
   * Checked from the root, not from the opened directory. `git ls-files --unmerged` is scoped to the directory it
   * runs in, so a conflict anywhere outside an opened subdirectory was invisible: the guard passed, staging marked
   * the conflict resolved with the markers still in the file, and the commit recorded them and reported success.
   */
  const preflightFailure = await validateCommitPreflight(projectPath, message)
  if (preflightFailure) return preflightFailure

  const pathResult = await prepareCommitPaths(projectPath, payload)
  if (!pathResult.ok) return pathResult.failure
  const { includeUnstaged, paths } = pathResult

  if (includeUnstaged) {
    const stageFailure = await stageCommitPaths(projectPath, paths)
    if (stageFailure) return stageFailure
  }

  const commitArgs = [...GIT_LITERAL_PATHS, 'commit', '-m', message]
  if (payload.amend) {
    commitArgs.push('--amend')
  }
  if (includeUnstaged && paths.length > 0) {
    commitArgs.push('--pathspec-from-file=-', '--pathspec-file-nul')
  }

  const commitResult = await runGit(
    projectPath,
    commitArgs,
    includeUnstaged && paths.length > 0 ? { input: encodeSelectedGitPaths(paths) } : {},
  )
  if (commitResult.code !== 0) {
    return mapCommitFailure(`${commitResult.stderr}\n${commitResult.stdout}`)
  }

  const commitHash = await resolveCommittedHead(projectPath)
  const summary = commitResult.stdout.trim().split('\n')[0] ?? 'Commit created.'

  return {
    ok: true,
    commitHash,
    summary,
    ...(commitHash === null
      ? {
          commitOutput: {
            ok: false as const,
            retryPersisted: false,
            message: COMMIT_HASH_UNAVAILABLE_MESSAGE,
          },
        }
      : {}),
  }
}

async function validateCommitPreflight(projectPath: string, message: string) {
  if (!message) {
    return commitFailure('empty-message', 'Commit message is required.')
  }
  if (!(await isGitRepository(projectPath))) {
    return commitFailure('not-git-repo', 'Selected folder is not a Git repository.')
  }

  /*
   * Unmerged index entries, not `MERGE_HEAD`.
   *
   * A rebase or a cherry-pick leaves conflicts without writing `MERGE_HEAD`, and this is a *pathspec* commit -
   * which git permits with unmerged entries where it refuses a whole-index one. Staging then marked the conflict
   * resolved with the markers still in the file, and either committed them reporting success (rebase) or failed
   * after destroying the three-stage entry, so the markers looked like the user's own resolution (cherry-pick).
   * Verified against real git: a rebase conflict has an unmerged entry and no `MERGE_HEAD`.
   */
  const unmerged = await runGit(projectPath, ['ls-files', '--unmerged'])
  if (unmerged.code !== 0) {
    const detail = unmerged.stderr.trim()
    return commitFailure(
      'unknown',
      detail
        ? `Could not inspect unresolved Git entries: ${detail}`
        : 'Could not inspect unresolved Git entries.',
    )
  }
  return unmerged.stdout.trim().length > 0
    ? commitFailure('merge-in-progress', 'Resolve the conflicts in progress before committing.')
    : null
}

async function stageCommitPaths(projectPath: string, paths: readonly string[]) {
  if (paths.length === 0) return null

  /*
   * `update-index --add --remove` stages additions, edits, and deletions for exact file paths. Its NUL input
   * also accepts an already-staged rename source that is gone from both disk and index. `git add -A` rejects
   * that source when batched, which previously forced one child process per selected file.
   */
  const addResult = await runGit(
    projectPath,
    [...GIT_LITERAL_PATHS, 'update-index', '--add', '--remove', '-z', '--stdin'],
    { input: encodeSelectedGitPaths(paths) },
  )
  return addResult.code === 0 ? null : mapCommitFailure(`${addResult.stderr}\n${addResult.stdout}`)
}

const commitPayloadSchema = Schema.Struct({
  sessionId: Schema.optional(Schema.String),
  message: Schema.String,
  amend: Schema.Boolean,
  paths: selectedGitPathsSchema,
  includeUnstaged: Schema.optional(Schema.Boolean),
})

export function registerGitCommitHandlers(): void {
  typedHandle('git:commit', (_event, rawPath: unknown, rawPayload: unknown) =>
    Effect.gen(function* () {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
      const decodedPayload = decodeUnknownOrThrow(commitPayloadSchema, rawPayload)
      const payload = {
        ...decodedPayload,
        sessionId:
          decodedPayload.sessionId === undefined ? undefined : SessionId(decodedPayload.sessionId),
      } satisfies GitCommitPayload
      return yield* withGitMutationLock(
        projectPath,
        Effect.gen(function* () {
          if (
            payload.sessionId &&
            !(yield* verifySessionWorkingPath(payload.sessionId, projectPath))
          ) {
            return commitFailure(
              'unknown',
              'The requested working tree does not belong to the originating session.',
            )
          }
          const occurrenceContext = payload.sessionId
            ? yield* resolveSessionOutputOccurrenceContext(payload.sessionId).pipe(
                Effect.catchAll(() =>
                  Effect.succeed({ nodeId: null, branchId: null, createdAt: Date.now() }),
                ),
              )
            : null
          const result = yield* Effect.promise(() => commitGit(projectPath, payload))
          if (result.ok) {
            invalidateGitStatusCache(projectPath)
            invalidateVcsStatus(projectPath)
            if (payload.sessionId && occurrenceContext) {
              if (result.commitHash === null) return result
              const commitOutput = yield* recordSessionCommitOutput(
                { commitHash: result.commitHash, summary: result.summary },
                payload.sessionId,
                occurrenceContext,
              )
              return { ...result, commitOutput }
            }
          }
          return result
        }),
      )
    }),
  )
}
