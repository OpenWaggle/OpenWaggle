import { decodeUnknownOrThrow } from '@shared/schema'
import type { ChangeRequestCheckoutResult } from '@shared/types/git'
import * as Effect from 'effect/Effect'
import { getSourceControlProvider } from '../../adapters/source-control'
import { typedHandle } from '../typed-ipc'
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
 * Make a change-request ref available locally without touching any working tree.
 *
 * A worktree-mode session only needs the ref as a base for its own tree. Running the provider's
 * checkout instead switched the user's opened checkout to the change-request branch as a side
 * effect - a real branch switch of a tree the session does not even use, which would also fail
 * or leave partial state on a dirty checkout.
 */
async function fetchChangeRequestRef(
  repositoryPath: string,
  reference: string,
): Promise<ChangeRequestCheckoutResult> {
  const refspec = `+refs/heads/${reference}:refs/remotes/${CHANGE_REQUEST_REMOTE}/${reference}`
  const result = await runGit(repositoryPath, ['fetch', CHANGE_REQUEST_REMOTE, refspec])
  if (result.code !== 0) {
    return {
      ok: false,
      code: 'unknown',
      message: result.stderr.trim() || `Could not fetch "${reference}".`,
    }
  }
  return { ok: true, reference }
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
