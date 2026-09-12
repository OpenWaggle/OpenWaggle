import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import type {
  ChangeRequestCheckoutResult,
  ChangeRequestPreflightPayload,
  ChangeRequestPreflightResult,
} from '@shared/types/git'
import { resolveAutoFeatureBranchName } from '@shared/utils/git-stacked-action'
import * as Effect from 'effect/Effect'
import { networkGitOptions } from '../../adapters/git/run-git'
import { typedHandle } from '../typed-ipc'
import { listGitBranches } from './branch-list'
import { resolveChangeRequestIdentity } from './change-request-identity'
import {
  buildChangeRequestFallbackUrl,
  resolveSourceControlProvider,
} from './change-request-provider'
import { planChangeRequestFetch } from './change-request-refs'
import { adoptionSchema, referenceSchema } from './change-request-schemas'
import { withGitMutationLock } from './mutation-lock'
import { projectPathSchema, runGit } from './shared'

const NO_PROVIDER = {
  ok: false,
  code: 'unknown',
  message: 'No supported source control provider.',
} as const

/** Longer than a ref advertisement, because this transfers objects. */
const CHANGE_REQUEST_FETCH_TIMEOUT_MS = 30_000

const openChangeRequestPayloadSchema = Schema.Struct({
  headRef: Schema.String,
  baseRef: Schema.optional(Schema.String),
  title: Schema.String,
  body: Schema.optional(Schema.String),
  draft: Schema.optional(Schema.Boolean),
  createFeatureBranch: Schema.optional(Schema.Boolean),
})

async function planChangeRequestHead(projectPath: string, payload: ChangeRequestPreflightPayload) {
  if (!payload.createFeatureBranch) return payload.headRef
  const branchList = await listGitBranches(projectPath)
  const preferred = resolveAutoFeatureBranchName([], payload.headRef)
  // A later provider step may fail after the stacked action has already created and checked out
  // this exact branch. Treat that current ref as prepared work: suffixing it here would make a
  // retry branch again from the base and strand the commit that was already pushed.
  if (branchList.currentBranch === preferred) return preferred
  const existing = branchList.branches.map((branch) => branch.localName)
  return resolveAutoFeatureBranchName(existing, payload.headRef)
}

/**
 * Make a change request's head commit available locally without touching any working tree.
 *
 * A worktree-mode session only needs the commit as a base for its own tree. Running the provider's
 * checkout instead switched the user's opened checkout to the change-request branch as a side
 * effect - a real branch switch of a tree the session does not even use, which would also fail or
 * leave partial state on a dirty checkout.
 *
 * The reference here is the change request's URL, not its head branch name: the branch only exists
 * on `origin` for a same-repository change request, so a fork-based one either failed to fetch or
 * silently resolved to an unrelated `origin` branch of the same name. Returns the local ref the
 * caller should record as its base.
 */
async function fetchChangeRequestRef(
  repositoryPath: string,
  remoteName: string,
  changeRequestUrl: string,
): Promise<ChangeRequestCheckoutResult> {
  const plan = planChangeRequestFetch(changeRequestUrl)
  if (plan === null) {
    return {
      ok: false,
      code: 'unknown',
      message: `Could not tell which change request "${changeRequestUrl}" refers to.`,
    }
  }

  const refspec = `+${plan.remoteRef}:${plan.localRef}`
  const result = await runGit(
    repositoryPath,
    ['fetch', remoteName, refspec],
    // A fetch reaches the network on an interactive path, so it is bounded and never prompts.
    networkGitOptions(CHANGE_REQUEST_FETCH_TIMEOUT_MS),
  )
  if (result.code !== 0) {
    return {
      ok: false,
      code: 'unknown',
      message: result.stderr.trim() || `Could not fetch ${plan.remoteRef}.`,
    }
  }
  // The base ref the session should use: a local ref that exists regardless of forks.
  return { ok: true, reference: plan.localRef }
}

export function registerGitChangeRequestHandlers(): void {
  typedHandle('git:change-request:preflight', (_event, rawPath: unknown, rawPayload: unknown) =>
    Effect.gen(function* () {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
      const payload = decodeUnknownOrThrow(
        openChangeRequestPayloadSchema,
        rawPayload,
      ) satisfies ChangeRequestPreflightPayload
      const plannedHeadRef = yield* Effect.promise(() =>
        planChangeRequestHead(projectPath, payload),
      )
      const plannedPayload = { ...payload, headRef: plannedHeadRef }
      const sourceControl = yield* Effect.promise(() => resolveSourceControlProvider(projectPath))
      if (!sourceControl) {
        const browserUrl = yield* Effect.promise(() =>
          buildChangeRequestFallbackUrl(projectPath, plannedPayload, false),
        )
        return {
          provider: null,
          readiness: {
            ok: false,
            code: 'unknown',
            message: 'No supported source control provider.',
          },
          browserUrl,
          plannedHeadRef,
        } satisfies ChangeRequestPreflightResult
      }
      const [readiness, browserUrl] = yield* Effect.promise(() =>
        Promise.all([
          sourceControl.provider.authStatus(projectPath),
          buildChangeRequestFallbackUrl(
            projectPath,
            plannedPayload,
            false,
            sourceControl.remoteUrl,
          ),
        ]),
      )
      return {
        provider: sourceControl.info,
        readiness,
        browserUrl,
        plannedHeadRef,
      } satisfies ChangeRequestPreflightResult
    }),
  )

  typedHandle('git:change-request:list', (_event, rawPath: unknown) =>
    Effect.gen(function* () {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
      const sourceControl = yield* Effect.promise(() => resolveSourceControlProvider(projectPath))
      if (!sourceControl) return NO_PROVIDER
      return yield* Effect.promise(() => sourceControl.provider.listChangeRequests(projectPath))
    }),
  )

  typedHandle(
    'git:change-request:checkout',
    (_event, rawPath: unknown, rawReference: unknown, rawAdoption: unknown) =>
      Effect.gen(function* () {
        const repositoryPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
        const reference = decodeUnknownOrThrow(referenceSchema, rawReference)
        const adoption = decodeUnknownOrThrow(adoptionSchema, rawAdoption)
        return yield* withGitMutationLock(
          repositoryPath,
          Effect.gen(function* () {
            const sourceControl = yield* Effect.promise(() =>
              resolveSourceControlProvider(repositoryPath),
            )
            if (!sourceControl) return NO_PROVIDER
            if (adoption === 'fetch') {
              const identity = resolveChangeRequestIdentity(
                sourceControl.remoteUrl,
                sourceControl.info.id,
                reference,
              )
              if (!identity) {
                return {
                  ok: false,
                  code: 'unknown',
                  message: `The change request does not belong to this repository.`,
                } as const
              }
              return yield* Effect.promise(() =>
                fetchChangeRequestRef(repositoryPath, sourceControl.remoteName, identity.url),
              )
            }
            return yield* Effect.promise(() =>
              sourceControl.provider.checkoutChangeRequest(repositoryPath, reference),
            )
          }),
        )
      }),
  )
}
