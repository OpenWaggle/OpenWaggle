import { decodeUnknownOrThrow, type Schema } from '@shared/schema'
import type {
  GitBranchCheckoutPayload,
  GitBranchCreatePayload,
  GitBranchDeletePayload,
  GitBranchMutationResult,
  GitBranchRenamePayload,
  GitBranchSetUpstreamPayload,
} from '@shared/types/git'
import * as Effect from 'effect/Effect'
import { typedHandle } from '../typed-ipc'
import { listGitBranches } from './branch-list'
import {
  checkoutGitBranch,
  createGitBranch,
  deleteGitBranch,
  renameGitBranch,
  setGitBranchUpstream,
} from './branch-mutations'
import {
  branchCheckoutPayloadSchema,
  branchCreatePayloadSchema,
  branchDeletePayloadSchema,
  branchRenamePayloadSchema,
  branchSetUpstreamPayloadSchema,
} from './branch-schemas'
import { projectPathSchema } from './shared'

type BranchMutationPayload =
  | GitBranchCheckoutPayload
  | GitBranchCreatePayload
  | GitBranchDeletePayload
  | GitBranchRenamePayload
  | GitBranchSetUpstreamPayload

function branchMutationHandler<TPayload extends BranchMutationPayload>(input: {
  readonly schema: Schema.Schema<TPayload>
  readonly run: (projectPath: string, payload: TPayload) => Promise<GitBranchMutationResult>
}) {
  return (_event: unknown, rawPath: unknown, rawPayload: unknown) =>
    Effect.gen(function* () {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
      const payload = decodeUnknownOrThrow(input.schema, rawPayload)
      return yield* Effect.promise(() => input.run(projectPath, payload))
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
  typedHandle(
    'git:branches:rename',
    branchMutationHandler({ schema: branchRenamePayloadSchema, run: renameGitBranch }),
  )
  typedHandle(
    'git:branches:delete',
    branchMutationHandler({ schema: branchDeletePayloadSchema, run: deleteGitBranch }),
  )
  typedHandle(
    'git:branches:set-upstream',
    branchMutationHandler({ schema: branchSetUpstreamPayloadSchema, run: setGitBranchUpstream }),
  )
}
