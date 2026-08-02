import { GIT_CACHE } from '@shared/constants/time'
import { decodeUnknownOrThrow } from '@shared/schema'
import * as Effect from 'effect/Effect'
import { typedHandle } from '../typed-ipc'
import { projectPathSchema } from './shared'
import { getCachedGitStatus, getGitStatusCacheToken, setCachedGitStatus } from './status-cache'
import { getGitBranchDiff, getGitDiff, getGitStatus } from './status-service'

export { invalidateGitStatusCache } from './status-cache'
export { mergeDiffsByPath, normalizeGitPath, parseUnifiedDiff } from './status-parse'

export function registerGitStatusHandlers() {
  typedHandle('git:status', (_event, rawPath: unknown) =>
    Effect.gen(function* () {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
      const cached = getCachedGitStatus(projectPath, GIT_CACHE.STATUS_TTL_MS)
      if (cached) return cached

      const cacheToken = getGitStatusCacheToken(projectPath)
      const result = yield* Effect.promise(() => getGitStatus(projectPath))
      setCachedGitStatus(projectPath, result, cacheToken)
      return result
    }),
  )

  typedHandle('git:diff', (_event, rawPath: unknown) =>
    Effect.gen(function* () {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
      return yield* Effect.promise(() => getGitDiff(projectPath))
    }),
  )

  typedHandle('git:branch-diff', (_event, rawPath: unknown, rawBaseRef: unknown) =>
    Effect.gen(function* () {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawPath)
      const baseRef = typeof rawBaseRef === 'string' ? rawBaseRef : ''
      return yield* Effect.promise(() => getGitBranchDiff(projectPath, baseRef))
    }),
  )
}
