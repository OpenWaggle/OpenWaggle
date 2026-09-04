import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { SessionId } from '@shared/types/brand'
import type { GitRunStackedActionOptions, GitRunStackedActionResult } from '@shared/types/git'
import { GIT_STACKED_ACTIONS } from '@shared/types/git'
import * as Effect from 'effect/Effect'
import { resolveSessionOutputOccurrenceContext } from '../../application/session-resource-recording'
import { typedHandle } from '../typed-ipc'
import { listGitBranches } from './branch-list'
import { createGitBranch } from './branch-mutations'
import {
  buildChangeRequestFallbackUrl,
  resolveSourceControlProvider,
} from './change-request-provider'
import { commitGit } from './commit-handler'
import { resolveDefaultRef } from './default-ref'
import { withGitMutationLock } from './mutation-lock'
import { resolvePrimaryRemote, resolvePrimaryRemoteUrl } from './primary-remote'
import { pullCurrentBranch, pushCurrentBranch } from './push-service'
import { verifySessionWorkingPath } from './session-working-path'
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
      const sourceControl = await resolveSourceControlProvider(projectPath)
      if (!sourceControl) {
        return { ok: false, code: 'unknown', message: 'No supported source control provider.' }
      }
      return sourceControl.provider.openChangeRequest(projectPath, payload)
    },
    preflightChangeRequest: async (projectPath) => {
      const sourceControl = await resolveSourceControlProvider(projectPath)
      if (!sourceControl) {
        return { ok: false, code: 'unknown', message: 'No supported source control provider.' }
      }
      const readiness = await sourceControl.provider.authStatus(
        projectPath,
        sourceControl.info.host,
      )
      if (!readiness.ok || readiness.status.authenticated) return readiness
      const cli = sourceControl.provider.id === 'github' ? 'gh' : 'glab'
      const label = sourceControl.provider.id === 'github' ? 'GitHub' : 'GitLab'
      return {
        ok: false,
        code: 'not-authenticated',
        message: `${label} CLI is not authenticated for ${sourceControl.info.host}. Run \`${cli} auth login --hostname ${sourceControl.info.host}\`.`,
      }
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

export function registerGitStackedActionHandlers(): void {
  const deps = createStackedActionDeps()
  typedHandle('git:stacked-action:run', (event, rawPath: unknown, rawOptions: unknown) =>
    Effect.gen(function* () {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
      const decodedOptions = decodeUnknownOrThrow(stackedActionOptionsSchema, rawOptions)
      const options = {
        ...decodedOptions,
        sessionId:
          decodedOptions.sessionId === undefined ? undefined : SessionId(decodedOptions.sessionId),
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
