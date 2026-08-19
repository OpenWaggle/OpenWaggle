import { decodeUnknownOrThrow } from '@shared/schema'
import type { ChangeRequestCheckoutResult } from '@shared/types/git'
import * as Effect from 'effect/Effect'
import { getSourceControlProvider } from '../../adapters/source-control'
import { typedHandle } from '../typed-ipc'
import { planChangeRequestFetch } from './change-request-refs'
import { adoptionSchema, referenceSchema } from './change-request-schemas'
import { projectPathSchema, runGit } from './shared'
import { detectSourceControlProvider } from './vcs-status-parse'

async function resolveProvider(projectPath: string) {
  const remote = await runGit(projectPath, ['remote', 'get-url', 'origin'])
  const remoteUrl = remote.code === 0 ? remote.stdout.trim() || null : null
  return getSourceControlProvider(detectSourceControlProvider(remoteUrl)?.id)
}

const NO_PROVIDER = {
  ok: false,
  code: 'unknown',
  message: 'No supported source control provider.',
} as const

/** The remote change-request branches are fetched from, matching the rest of the git module. */
const CHANGE_REQUEST_REMOTE = 'origin'

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
  const result = await runGit(repositoryPath, ['fetch', CHANGE_REQUEST_REMOTE, refspec])
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
  typedHandle('git:change-request:list', (_event, rawPath: unknown) =>
    Effect.gen(function* () {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
      const provider = yield* Effect.promise(() => resolveProvider(projectPath))
      if (!provider) return NO_PROVIDER
      return yield* Effect.promise(() => provider.listChangeRequests(projectPath))
    }),
  )

  typedHandle(
    'git:change-request:checkout',
    (_event, rawPath: unknown, rawReference: unknown, rawAdoption: unknown) =>
      Effect.gen(function* () {
        const repositoryPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
        const reference = decodeUnknownOrThrow(referenceSchema, rawReference)
        const adoption = decodeUnknownOrThrow(adoptionSchema, rawAdoption)
        if (adoption === 'fetch') {
          return yield* Effect.promise(() => fetchChangeRequestRef(repositoryPath, reference))
        }
        const provider = yield* Effect.promise(() => resolveProvider(repositoryPath))
        if (!provider) return NO_PROVIDER
        return yield* Effect.promise(() =>
          provider.checkoutChangeRequest(repositoryPath, reference),
        )
      }),
  )
}
