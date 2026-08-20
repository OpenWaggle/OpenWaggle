import { decodeUnknownOrThrow } from '@shared/schema'
import * as Effect from 'effect/Effect'
import { typedHandle } from '../typed-ipc'
import { projectPathSchema } from './shared'
import { readLocalVcsStatus, readRemoteVcsStatus } from './vcs-status-cache'

export function registerGitVcsStatusHandlers(): void {
  typedHandle('git:vcs-status:local', (_event, rawPath: unknown) =>
    Effect.gen(function* () {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
      return yield* Effect.promise(() => readLocalVcsStatus(projectPath))
    }),
  )

  typedHandle('git:vcs-status:remote', (_event, rawPath: unknown) =>
    Effect.gen(function* () {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
      return yield* Effect.promise(() => readRemoteVcsStatus(projectPath))
    }),
  )
}
