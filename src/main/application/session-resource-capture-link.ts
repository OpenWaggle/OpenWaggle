import { randomUUID } from 'node:crypto'
import type { SessionId } from '@shared/types/brand'
import type { SessionResourceActivity, SessionResourceActor } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import { SessionResourceRepository } from '../ports/session-resource-repository'
import { occurrence, occurrenceId, sha256 } from './session-resource-capture-shared'
import type { CapturedLink } from './session-resource-extraction'

export interface LinkCaptureInput {
  readonly sessionId: SessionId
  readonly runId: string
  readonly link: CapturedLink
  readonly index: number
  readonly nodeId: string | null
  readonly actor: SessionResourceActor
  readonly activity: SessionResourceActivity
  readonly createdAt: number
  readonly branchId?: string | null
}

export function linkOccurrenceId(input: LinkCaptureInput) {
  return occurrenceId({
    ...input,
    suffix: `${input.activity}:link:${String(input.index)}:${sha256(Buffer.from(input.link.url))}`,
  })
}

function linkOccurrence(input: LinkCaptureInput, id: string) {
  return occurrence({
    id,
    nodeId: input.nodeId,
    branchId: input.branchId,
    actor: input.actor,
    activity: input.activity,
    createdAt: input.createdAt,
  })
}

export function captureLink(input: LinkCaptureInput) {
  return Effect.gen(function* () {
    const repository = yield* SessionResourceRepository
    const id = linkOccurrenceId(input)
    if (yield* repository.hasOccurrence(input.sessionId, id)) return
    const resourceId = randomUUID()
    const canonicalKey = `${input.link.image ? 'image-url' : 'url'}:${input.link.url}`
    const existing = yield* repository.findByCanonicalKey(input.sessionId, canonicalKey)
    if (existing) {
      yield* repository.upsert({
        id: existing.id,
        sessionId: input.sessionId,
        canonicalKey,
        kind: existing.kind,
        title: existing.title,
        mimeType: existing.mimeType,
        locator: existing.locator,
        managedPath: null,
        available: existing.available,
        occurrence: linkOccurrence(input, id),
        createdAt: existing.createdAt,
        updatedAt: input.createdAt,
      })
      return
    }
    yield* repository.upsert({
      id: resourceId,
      sessionId: input.sessionId,
      canonicalKey,
      kind: input.link.image ? 'image' : 'link',
      title: input.link.title,
      mimeType: null,
      locator: input.link.url,
      managedPath: null,
      available: true,
      occurrence: linkOccurrence(input, id),
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    })
  })
}
