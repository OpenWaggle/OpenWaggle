import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { SessionId } from '@shared/types/brand'
import type { GitRunStackedActionOptions, GitRunStackedActionResult } from '@shared/types/git'
import { GIT_STACKED_ACTIONS } from '@shared/types/git'
import * as Effect from 'effect/Effect'
import { resolveSessionOutputOccurrenceContext } from '../../application/session-resource-recording'
import { typedHandle } from '../typed-ipc'
import { listGitBranchNames } from './branch-list'
import { createGitBranch } from './branch-mutations'
import {
  buildChangeRequestFallbackUrl,
  resolveSourceControlProvider,
  sourceControlProviderForRepository,
} from './change-request-provider'
import { commitGit } from './commit-handler'
import { selectedGitPathsSchema } from './commit-path-contract'
import { resolveDefaultRef } from './default-ref'
import { withGitMutationLock } from './mutation-lock'
import { resolvePrimaryRemote, resolvePrimaryRemoteUrl } from './primary-remote'
import {
  type GitPinnedPushTarget,
  type GitPushDestination,
  pullCurrentBranch,
  pushCurrentBranch,
} from './push-service'
import { verifySessionWorkingPath } from './session-working-path'
import { projectPathSchema, runGit } from './shared'
import {
  confirmDefaultBranchAction,
  resolvePlannedFeatureRef,
  revalidateGitTarget,
} from './stacked-action-default-branch-gate'
import { recordStackedActionOutputs } from './stacked-action-output-recording'
import { runStackedGitAction, type StackedActionDeps } from './stacked-action-service'
import { invalidateGitStatusCache } from './status-cache'
import { GIT_RAW_PATHS } from './status-constants'
import { invalidateVcsStatus } from './vcs-status-cache'
import { resolveRepositoryRoot } from './working-tree-service'

interface ActiveGitOperation {
  readonly senderId: number
  cancelled: boolean
}

const activeGitOperations = new Map<string, ActiveGitOperation>()

function operationKey(senderId: number, operationId: string) {
  return `${String(senderId)}:${operationId}`
}

function registerActiveOperation(senderId: number, operationId: string | undefined) {
  if (!operationId) return null
  const token: ActiveGitOperation = { senderId, cancelled: false }
  activeGitOperations.set(operationKey(senderId, operationId), token)
  return token
}

function releaseActiveOperation(operationId: string | undefined, token: ActiveGitOperation | null) {
  if (!operationId || !token) return
  const key = operationKey(token.senderId, operationId)
  if (activeGitOperations.get(key) === token) activeGitOperations.delete(key)
}

const stackedActionOptionsSchema = Schema.Struct({
  action: Schema.Literal(...GIT_STACKED_ACTIONS),
  operationId: Schema.optional(Schema.String),
  sessionId: Schema.optional(Schema.String),
  commitMessage: Schema.optional(Schema.String),
  createFeatureBranch: Schema.optional(Schema.Boolean),
  featureBranchName: Schema.optional(Schema.String),
  exactFeatureBranchName: Schema.optional(Schema.Boolean),
  baseRef: Schema.optional(Schema.String),
  changeRequestTitle: Schema.optional(Schema.String),
  changeRequestBody: Schema.optional(Schema.String),
  draft: Schema.optional(Schema.Boolean),
  paths: Schema.optional(selectedGitPathsSchema),
  includeUnstaged: Schema.optional(Schema.Boolean),
})

function createStackedActionDeps(): StackedActionDeps {
  return {
    hasWorkingTreeChanges: async (projectPath) => {
      const result = await runGit(projectPath, [...GIT_RAW_PATHS, 'status', '--porcelain=v1', '-z'])
      if (result.code !== 0) {
        // Ignoring the exit code made an unreadable repository indistinguishable from a clean
        // one, so the commit phase was skipped and the action reported success regardless.
        return { ok: false, message: result.stderr.trim() || 'Could not read the working tree.' }
      }
      return { ok: true, hasChanges: result.stdout.trim().length > 0 }
    },
    listBranchNames: listGitBranchNames,
    createBranch: async (projectPath, name, baseRef) => {
      const result = await createGitBranch(projectPath, {
        name,
        startPoint: baseRef,
        checkout: true,
      })
      return { ok: result.ok, message: result.message }
    },
    commit: async (projectPath, message, paths, includeUnstaged) => {
      // Never let an empty visible selection fall back to repository-wide `git add --all`.
      const selected = paths?.filter((entry) => entry.length > 0) ?? []
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
      return commitGit(repositoryRoot, {
        message,
        amend: false,
        paths: [...selected],
        includeUnstaged,
      })
    },
    push: (projectPath) => pushCurrentBranch(projectPath),
    pull: (projectPath) => pullCurrentBranch(projectPath),
    openChangeRequest: async (projectPath, payload) => {
      const sourceControl = payload.targetRepository
        ? sourceControlProviderForRepository(payload.targetRepository)
        : await resolveSourceControlProvider(projectPath)
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
      const readiness = await sourceControl.provider.authStatus(projectPath)
      if (!readiness.ok || readiness.status.authenticated) return readiness
      const cli = sourceControl.provider.id === 'github' ? 'gh' : 'glab'
      const label = sourceControl.provider.id === 'github' ? 'GitHub' : 'GitLab'
      return {
        ok: false,
        code: 'not-authenticated',
        message: `${label} CLI is not authenticated for ${sourceControl.info.host}. Run \`${cli} auth login --hostname ${sourceControl.info.host}\`.`,
      }
    },
    // Every production invocation replaces this with the destination approved by the safety
    // gate. Keeping the dependency explicit makes preflight mandatory and unit-testable.
    resolveApprovedPushDestination: async () => null,
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

function approvedPushDestination(target: GitPinnedPushTarget | null): GitPushDestination | null {
  if (!target) return null
  return {
    remote: target.remote,
    branch: target.branch,
    remoteUrl: target.pushUrls.length === 1 ? (target.pushUrls[0] ?? null) : null,
    multiplePushUrls: target.pushUrls.length > 1,
  }
}

function registerGitStackedActionCancelHandler() {
  typedHandle('git:stacked-action:cancel', (event, rawOperationId: unknown) =>
    Effect.sync(() => {
      const operationId = decodeUnknownOrThrow(Schema.String, rawOperationId)
      const token = activeGitOperations.get(operationKey(event.sender.id, operationId))
      if (!token) return false
      token.cancelled = true
      return true
    }),
  )
}

export function registerGitStackedActionHandlers(): void {
  const deps = createStackedActionDeps()
  registerGitStackedActionCancelHandler()
  typedHandle('git:stacked-action:run', (event, rawPath: unknown, rawOptions: unknown) =>
    Effect.gen(function* () {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
      const decodedOptions = decodeUnknownOrThrow(stackedActionOptionsSchema, rawOptions)
      const options = {
        ...decodedOptions,
        sessionId:
          decodedOptions.sessionId === undefined ? undefined : SessionId(decodedOptions.sessionId),
      } satisfies GitRunStackedActionOptions
      const operation = registerActiveOperation(event.sender.id, options.operationId)
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
          if (operation?.cancelled) {
            return {
              ok: false,
              phase: 'commit',
              code: 'cancelled',
              message: 'Action cancelled.',
            } satisfies GitRunStackedActionResult
          }
          const confirmation = yield* confirmDefaultBranchAction(event, projectPath, options)
          if (!confirmation.confirmed) {
            if (confirmation.blockingFailure) {
              return {
                ok: false,
                phase: 'push',
                code: 'push-failed',
                message: confirmation.blockingFailure,
              } satisfies GitRunStackedActionResult
            }
            return {
              ok: false,
              phase: 'commit',
              code: 'cancelled',
              message: 'Action cancelled.',
            } satisfies GitRunStackedActionResult
          }
          const targetRevalidation = yield* revalidateGitTarget(
            projectPath,
            confirmation.targetIdentity,
            options.action,
            resolvePlannedFeatureRef(options),
          )
          if (!targetRevalidation.matches) {
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
          const pinnedPushTarget = targetRevalidation.pinnedPushTarget
          const actionDeps: StackedActionDeps = {
            ...deps,
            resolveApprovedPushDestination: async () => approvedPushDestination(pinnedPushTarget),
            ...(pinnedPushTarget
              ? {
                  push: (path: string) => pushCurrentBranch(path, undefined, pinnedPushTarget),
                }
              : {}),
          }
          const result = yield* Effect.promise(() =>
            runStackedGitAction(
              actionDeps,
              projectPath,
              options,
              (progress) => {
                if (
                  !options.operationId ||
                  (typeof event.sender.isDestroyed === 'function' && event.sender.isDestroyed())
                ) {
                  return
                }
                event.sender.send('git:stacked-action:progress', {
                  operationId: options.operationId,
                  workingPath: projectPath,
                  progress,
                })
              },
              () => operation?.cancelled === true,
            ),
          )
          // Stacked actions commit and push, so the working tree's status changed too.
          invalidateGitStatusCache(projectPath)
          invalidateVcsStatus(projectPath)
          return options.sessionId && occurrenceContext
            ? yield* recordStackedActionOutputs(result, options.sessionId, occurrenceContext)
            : result
        }),
      ).pipe(
        Effect.ensuring(Effect.sync(() => releaseActiveOperation(options.operationId, operation))),
      )
    }),
  )
}
