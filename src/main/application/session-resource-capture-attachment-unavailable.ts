import type { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import type { SessionResourceRepositoryShape } from '../ports/session-resource-repository'

interface UnavailableAttachmentLookup {
  readonly sessionId: SessionId
  readonly sourcePath: string
  readonly repairResource?: SessionResource
}

export function findUnavailableAttachment(
  repository: SessionResourceRepositoryShape,
  input: UnavailableAttachmentLookup,
  occurrenceId: string,
  canonicalKey: string,
) {
  if (input.repairResource) {
    const candidate = input.repairResource
    if (candidate.available || !candidate.canonicalKey.startsWith('file:')) {
      return Effect.succeed(candidate)
    }
    const soleOccurrence = candidate.occurrences.length === 1 ? candidate.occurrences[0] : null
    return Effect.succeed(soleOccurrence?.id === occurrenceId ? candidate : null)
  }
  return Effect.gen(function* () {
    const current = yield* repository.findByCanonicalKey(input.sessionId, canonicalKey)
    const legacy = current
      ? null
      : yield* repository.findByCanonicalKey(input.sessionId, `file:${input.sourcePath}`)
    if (current?.occurrences.length === 1 && current.occurrences[0]?.id === occurrenceId) {
      return current
    }
    if (legacy?.occurrences.length === 1 && legacy.occurrences[0]?.id === occurrenceId) {
      return legacy
    }
    return null
  })
}
