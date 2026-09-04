import { randomUUID } from 'node:crypto'
import type { SessionId } from '@shared/types/brand'
import type { SessionResourceActivity, SessionResourceActor } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import {
  SessionResourceRepository,
  type SessionResourceRepositoryShape,
} from '../ports/session-resource-repository'
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

function findExistingLinkResource(
  repository: SessionResourceRepositoryShape,
  input: LinkCaptureInput,
  canonicalKey: string,
) {
  return Effect.gen(function* () {
    const direct = yield* repository.findByCanonicalKey(input.sessionId, canonicalKey)
    const compatible = (resource: { readonly kind: string }) =>
      input.link.image ? resource.kind === 'image' : resource.kind !== 'image'
    if (direct) {
      return compatible(direct)
        ? ({ _tag: 'Existing' as const, resource: direct } as const)
        : ({ _tag: 'Blocked' as const } as const)
    }
    if (!input.link.image) return { _tag: 'Missing' as const }
    const existing = (yield* repository.list(input.sessionId)).find((candidate) => {
      if (candidate.kind !== 'image') return false
      const prefix = 'image-url:'
      if (!candidate.canonicalKey.startsWith(prefix)) return false
      try {
        return new URL(candidate.canonicalKey.slice(prefix.length)).href === input.link.url
      } catch {
        return false
      }
    })
    return existing
      ? ({ _tag: 'Existing' as const, resource: existing } as const)
      : ({ _tag: 'Missing' as const } as const)
  })
}

export function captureLink(input: LinkCaptureInput) {
  return Effect.gen(function* () {
    const repository = yield* SessionResourceRepository
    const id = linkOccurrenceId(input)
    if (yield* repository.hasOccurrence(input.sessionId, id)) return
    const resourceId = randomUUID()
    const canonicalKey = `${input.link.image ? 'image-url' : 'url'}:${input.link.url}`
    const existing = yield* findExistingLinkResource(repository, input, canonicalKey)
    if (existing._tag === 'Blocked') return
    if (existing._tag === 'Existing') {
      const resource = existing.resource
      yield* repository.upsert({
        id: resource.id,
        sessionId: input.sessionId,
        canonicalKey: resource.canonicalKey,
        kind: resource.kind,
        title: resource.title,
        mimeType: resource.mimeType,
        locator: resource.locator,
        managedPath: null,
        available: resource.available,
        occurrence: linkOccurrence(input, id),
        createdAt: resource.createdAt,
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
