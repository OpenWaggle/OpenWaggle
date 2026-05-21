import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import type { GitCommitFailure, GitCommitPayload, GitCommitResult } from '@shared/types/git'
import * as Effect from 'effect/Effect'
import { typedHandle } from '../typed-ipc'
import { isGitRepository, projectPathSchema, runGit } from './shared'
import { invalidateGitStatusCache } from './status-handler'

function commitFailure(code: GitCommitFailure['code'], message: string): GitCommitFailure {
  return { ok: false, code, message }
}

function mapCommitFailure(stderr: string): GitCommitFailure {
  const message = stderr.trim()
  const lower = message.toLowerCase()

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

async function commitGit(projectPath: string, payload: GitCommitPayload): Promise<GitCommitResult> {
  const message = payload.message.trim()
  const preflightFailure = await validateCommitPreflight(projectPath, message)
  if (preflightFailure) return preflightFailure

  // Stage only the files explicitly selected by the user.
  const stageFailure = await stageCommitPaths(projectPath, payload.paths)
  if (stageFailure) return stageFailure

  const commitArgs = ['commit', '-m', message]
  if (payload.amend) {
    commitArgs.push('--amend')
  }
  if (payload.paths.length > 0) {
    commitArgs.push('--', ...payload.paths)
  }

  const commitResult = await runGit(projectPath, commitArgs)
  if (commitResult.code !== 0) {
    return mapCommitFailure(`${commitResult.stderr}\n${commitResult.stdout}`)
  }

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

async function stageCommitPaths(projectPath: string, paths: readonly string[]) {
  if (paths.length === 0) return null

  const addResult = await runGit(projectPath, ['add', '--', ...paths])
  return addResult.code === 0 ? null : mapCommitFailure(addResult.stderr)
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
      }
      return result
    }),
  )
}
