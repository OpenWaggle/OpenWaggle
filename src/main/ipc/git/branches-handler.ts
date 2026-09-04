import { decodeUnknownOrThrow, type Schema } from '@shared/schema'
import type {
  GitBranchCheckoutPayload,
  GitBranchCreatePayload,
  GitBranchMutationResult,
} from '@shared/types/git'
import * as Effect from 'effect/Effect'
import { typedHandle } from '../typed-ipc'
import { listGitBranches } from './branch-list'
import { checkoutGitBranch, createGitBranch } from './branch-mutations'
import { branchCheckoutPayloadSchema, branchCreatePayloadSchema } from './branch-schemas'
import { withGitMutationLock } from './mutation-lock'
import { projectPathSchema } from './shared'
import { invalidateGitStatusCache } from './status-cache'
import { invalidateVcsStatus } from './vcs-status-cache'

type BranchMutationPayload = GitBranchCheckoutPayload | GitBranchCreatePayload

function branchMutationHandler<TPayload extends BranchMutationPayload>(input: {
  readonly schema: Schema.Schema<TPayload>
  readonly run: (projectPath: string, payload: TPayload) => Promise<GitBranchMutationResult>
}) {
  return (_event: unknown, rawPath: unknown, rawPayload: unknown) =>
    Effect.gen(function* () {
      const workingPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
      const payload = decodeUnknownOrThrow(input.schema, rawPayload)
      return yield* withGitMutationLock(
        workingPath,
        Effect.gen(function* () {
          const result = yield* Effect.promise(() => input.run(workingPath, payload))
          /*
           * A checkout or branch creation moves the working tree's HEAD, so both caches over it are stale and every
           * window watching that tree needs to know.
           */
          if (result.ok) {
            invalidateGitStatusCache(workingPath)
            invalidateVcsStatus(workingPath)
          }
          return result
        }),
      )
    })
}

export function registerGitBranchHandlers(): void {
  typedHandle('git:branches:list', (_event, rawPath: unknown) =>
    Effect.gen(function* () {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
      return yield* Effect.promise(() => listGitBranches(projectPath))
    }),
  )

  typedHandle(
    'git:branches:checkout',
    branchMutationHandler({ schema: branchCheckoutPayloadSchema, run: checkoutGitBranch }),
  )
  typedHandle(
    'git:branches:create',
    branchMutationHandler({ schema: branchCreatePayloadSchema, run: createGitBranch }),
  )
}
