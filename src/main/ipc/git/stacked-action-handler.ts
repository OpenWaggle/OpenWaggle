import fs from 'node:fs/promises'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { SessionId } from '@shared/types/brand'
import type {
  GitRunStackedActionOptions,
  GitRunStackedActionResult,
  OpenChangeRequestPayload,
} from '@shared/types/git'
import { GIT_STACKED_ACTIONS } from '@shared/types/git'
import { resolveSessionWorkingDir } from '@shared/utils/worktree'
import * as Effect from 'effect/Effect'
import { getSourceControlProvider } from '../../adapters/source-control'
import { resolveSessionOutputOccurrenceContext } from '../../application/session-resource-recording'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import { typedHandle } from '../typed-ipc'
import { listGitBranches } from './branch-list'
import { createGitBranch } from './branch-mutations'
import { commitGit } from './commit-handler'
import { resolveDefaultRef } from './default-ref'
import { withGitMutationLock } from './mutation-lock'
import { resolvePrimaryRemote, resolvePrimaryRemoteUrl } from './primary-remote'
import { pullCurrentBranch, pushCurrentBranch } from './push-service'
import { repositoryWebUrl } from './repository-web-url'
import { projectPathSchema, runGit } from './shared'
import {
  confirmDefaultBranchAction,
  revalidateGitTarget,
} from './stacked-action-default-branch-gate'
import { recordStackedActionOutputs } from './stacked-action-output-recording'
import { runStackedGitAction, type StackedActionDeps } from './stacked-action-service'
import { invalidateGitStatusCache } from './status-cache'
import { GIT_RAW_PATHS } from './status-constants'
import { invalidateVcsStatus } from './vcs-status-cache'
import { detectSourceControlProvider } from './vcs-status-parse'
import { resolveRepositoryRoot } from './working-tree-service'

const stackedActionOptionsSchema = Schema.Struct({
  action: Schema.Literal(...GIT_STACKED_ACTIONS),
  sessionId: Schema.optional(Schema.String),
  commitMessage: Schema.optional(Schema.String),
  createFeatureBranch: Schema.optional(Schema.Boolean),
  featureBranchName: Schema.optional(Schema.String),
  baseRef: Schema.optional(Schema.String),
  changeRequestTitle: Schema.optional(Schema.String),
  changeRequestBody: Schema.optional(Schema.String),
  draft: Schema.optional(Schema.Boolean),
  paths: Schema.optional(Schema.Array(Schema.String)),
})

async function buildChangeRequestFallbackUrl(
  projectPath: string,
  payload: OpenChangeRequestPayload,
) {
  const remoteUrl = await resolvePrimaryRemoteUrl(projectPath)
  if (!remoteUrl) return null
  const provider = detectSourceControlProvider(remoteUrl)
  const webUrl = repositoryWebUrl(remoteUrl)
  if (!provider || !webUrl) return null
  if (provider.id === 'github') {
    // A provider-native create can verify a fork relationship. A browser compare URL cannot,
    // so do not offer a potentially unrelated same-named repository as a recovery target.
    if (payload.headOwner) return null
    const headRef = payload.headRef
    const comparison = payload.baseRef
      ? `${encodeURIComponent(payload.baseRef)}...${encodeURIComponent(headRef)}`
      : encodeURIComponent(headRef)
    const url = new URL(`${webUrl}/compare/${comparison}`)
    url.searchParams.set('expand', '1')
    url.searchParams.set('title', payload.title)
    if (payload.body) url.searchParams.set('body', payload.body)
    return url.toString()
  }
  if (payload.headRepository) return null
  const url = new URL(`${webUrl}/-/merge_requests/new`)
  url.searchParams.set('merge_request[source_branch]', payload.headRef)
  if (payload.baseRef) url.searchParams.set('merge_request[target_branch]', payload.baseRef)
  url.searchParams.set('merge_request[title]', payload.title)
  if (payload.body) url.searchParams.set('merge_request[description]', payload.body)
  if (payload.draft) url.searchParams.set('merge_request[draft]', 'true')
  return url.toString()
}

function createStackedActionDeps(): StackedActionDeps {
  return {
    hasWorkingTreeChanges: async (projectPath) => {
      const result = await runGit(projectPath, [...GIT_RAW_PATHS, 'status', '--porcelain=v1'])
      if (result.code !== 0) {
        // Ignoring the exit code made an unreadable repository indistinguishable from a clean
        // one, so the commit phase was skipped and the action reported success regardless.
        return { ok: false, message: result.stderr.trim() || 'Could not read the working tree.' }
      }
      return { ok: true, hasChanges: result.stdout.trim().length > 0 }
    },
    listBranchNames: async (projectPath) => {
      const list = await listGitBranches(projectPath)
      const names: string[] = []
      for (const branch of list.branches) {
        names.push(branch.isRemote ? branch.name.split('/').slice(1).join('/') : branch.name)
      }
      return names
    },
    createBranch: async (projectPath, name, baseRef) => {
      const result = await createGitBranch(projectPath, {
        name,
        startPoint: baseRef,
        checkout: true,
      })
      return { ok: result.ok, message: result.message }
    },
    commit: async (projectPath, message, paths) => {
      // Never let an empty visible selection fall back to repository-wide `git add --all`.
      const selected = paths?.filter((entry) => entry.trim().length > 0) ?? []
      if (selected.length === 0) {
        return {
          ok: false,
          code: 'nothing-to-commit',
          message: 'Select the files to commit: nothing was staged for this action.',
        }
      }
      // Porcelain paths are repository-relative, so stage and commit from the root.
      const repositoryRoot = (await resolveRepositoryRoot(projectPath)) ?? projectPath
      // `commitGit` owns deleted-path and staged-rename handling.
      return commitGit(repositoryRoot, { message, amend: false, paths: [...selected] })
    },
    push: async (projectPath) => {
      const primaryRemote = await resolvePrimaryRemote(projectPath)
      return pushCurrentBranch(projectPath, primaryRemote?.name ?? 'origin')
    },
    pull: (projectPath) => pullCurrentBranch(projectPath),
    openChangeRequest: async (projectPath, payload) => {
      const provider = getSourceControlProvider(
        detectSourceControlProvider(await resolvePrimaryRemoteUrl(projectPath))?.id,
      )
      if (!provider) {
        return { ok: false, code: 'unknown', message: 'No supported source control provider.' }
      }
      return provider.openChangeRequest(projectPath, payload)
    },
    resolveCurrentRef: async (projectPath) => {
      const result = await runGit(projectPath, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
      return result.code === 0 ? result.stdout.trim() || null : null
    },
    resolveDefaultBaseRef: async (projectPath) => {
      const primaryRemote = await resolvePrimaryRemote(projectPath)
      return resolveDefaultRef(projectPath, primaryRemote?.name ?? 'origin')
    },
    resolvePrimaryRemoteUrl,
    buildChangeRequestFallbackUrl,
  }
}

function verifySessionWorkingPath(sessionId: SessionId, requestedWorkingPath: string) {
  return Effect.gen(function* () {
    const sessions = yield* SessionProjectionRepository
    const session = yield* sessions.getOptional(sessionId)
    if (!session) return false
    const expectedWorkingPath = resolveSessionWorkingDir(session, session.projectPath)
    if (!expectedWorkingPath) return false
    const [requestedRoot, expectedRoot] = yield* Effect.promise(() =>
      Promise.all([
        resolveRepositoryRoot(requestedWorkingPath).then((root) => root ?? requestedWorkingPath),
        resolveRepositoryRoot(expectedWorkingPath).then((root) => root ?? expectedWorkingPath),
      ]),
    )
    const [realRequestedRoot, realExpectedRoot] = yield* Effect.promise(() =>
      Promise.all([fs.realpath(requestedRoot), fs.realpath(expectedRoot)]),
    )
    return realRequestedRoot === realExpectedRoot
  }).pipe(Effect.catchAll(() => Effect.succeed(false)))
}

export function registerGitStackedActionHandlers(): void {
  const deps = createStackedActionDeps()
  typedHandle('git:stacked-action:run', (event, rawPath: unknown, rawOptions: unknown) =>
    Effect.gen(function* () {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
      const decodedOptions = decodeUnknownOrThrow(stackedActionOptionsSchema, rawOptions)
      const options = {
        ...decodedOptions,
        sessionId: decodedOptions.sessionId ? SessionId(decodedOptions.sessionId) : undefined,
      } satisfies GitRunStackedActionOptions
      return yield* withGitMutationLock(
        projectPath,
        Effect.gen(function* () {
          if (
            options.sessionId &&
            !(yield* verifySessionWorkingPath(options.sessionId, projectPath))
          ) {
            return {
              ok: false,
              phase: 'commit',
              code: 'unknown',
              message: 'The requested working tree does not belong to the originating session.',
            } satisfies GitRunStackedActionResult
          }
          const confirmation = yield* confirmDefaultBranchAction(event, projectPath, options)
          if (!confirmation.confirmed) {
            return {
              ok: false,
              phase: 'commit',
              code: 'cancelled',
              message: 'Action cancelled.',
            } satisfies GitRunStackedActionResult
          }
          if (!(yield* revalidateGitTarget(projectPath, confirmation.targetIdentity))) {
            return {
              ok: false,
              phase: 'commit',
              code: 'unknown',
              message: 'The current branch or push destination changed. Review the action again.',
            } satisfies GitRunStackedActionResult
          }
          const occurrenceContext = options.sessionId
            ? yield* resolveSessionOutputOccurrenceContext(options.sessionId).pipe(
                Effect.catchAll(() =>
                  Effect.succeed({ nodeId: null, branchId: null, createdAt: Date.now() }),
                ),
              )
            : null
          const result = yield* Effect.promise(() =>
            runStackedGitAction(deps, projectPath, options),
          )
          // Stacked actions commit and push, so the working tree's status changed too.
          invalidateGitStatusCache(projectPath)
          invalidateVcsStatus(projectPath)
          return options.sessionId && occurrenceContext
            ? yield* recordStackedActionOutputs(result, options.sessionId, occurrenceContext)
            : result
        }),
      )
    }),
  )
}
