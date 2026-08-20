import { decodeUnknownOrThrow } from '@shared/schema'
import * as Effect from 'effect/Effect'
import { getSourceControlProvider } from '../../adapters/source-control'
import { typedHandle } from '../typed-ipc'
import { referenceSchema } from './change-request-schemas'
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

export function registerGitChangeRequestHandlers(): void {
  typedHandle('git:change-request:list', (_event, rawPath: unknown) =>
    Effect.gen(function* () {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
      const provider = yield* Effect.promise(() => resolveProvider(projectPath))
      if (!provider) return NO_PROVIDER
      return yield* Effect.promise(() => provider.listChangeRequests(projectPath))
    }),
  )

  typedHandle('git:change-request:checkout', (_event, rawPath: unknown, rawReference: unknown) =>
    Effect.gen(function* () {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
      const reference = decodeUnknownOrThrow(referenceSchema, rawReference)
      const provider = yield* Effect.promise(() => resolveProvider(projectPath))
      if (!provider) return NO_PROVIDER
      return yield* Effect.promise(() => provider.checkoutChangeRequest(projectPath, reference))
    }),
  )
}
