import type { Message } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { SessionNode } from '@shared/types/session'
import type { SessionResource } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import { SessionResourceRepository } from '../ports/session-resource-repository'
import {
  ASSISTANT_LINK_CAPTURE_LIMIT,
  captureAttachment,
  captureGeneratedImage,
  captureLink,
  prepareGeneratedImageForCapture,
} from './session-resource-capture'
import { generatedImageOccurrencePrefix } from './session-resource-capture-image'
import { linkOccurrenceId } from './session-resource-capture-link'
import { collectExplicitResources } from './session-resource-extraction'
import { withSessionResourceLock } from './session-resource-lock'

interface ProjectedResourceMessage {
  readonly message: Message
  readonly nodeId: string
  readonly branchId: string | null
}

interface BackfillImageState {
  budget: { readonly bytes: number; readonly count: number }
  readonly capturedSlots: Set<string>
}

interface BackfillLinkState {
  count: number
  readonly capturedOccurrences: Set<string>
}

function projectResourceMessages(input: {
  readonly messages?: readonly Message[]
  readonly nodes?: readonly SessionNode[]
}): readonly ProjectedResourceMessage[] {
  return input.nodes
    ? input.nodes.flatMap((node) =>
        node.message
          ? [
              {
                message: node.message,
                nodeId: String(node.id),
                branchId: node.branchId ?? null,
              },
            ]
          : [],
      )
    : (input.messages ?? []).map((message) => ({
        message,
        nodeId: String(message.id),
        branchId: null,
      }))
}

function capturedGeneratedImageSlots(resources: readonly SessionResource[]) {
  const slots = new Set<string>()
  for (const resource of resources) {
    for (const occurrence of resource.occurrences) {
      if (!occurrence.id.includes(':created:image:')) continue
      const digestSeparator = occurrence.id.lastIndexOf(':')
      if (digestSeparator !== -1) slots.add(occurrence.id.slice(0, digestSeparator + 1))
    }
  }
  return slots
}

function capturedOccurrenceIds(resources: readonly SessionResource[]) {
  return new Set(resources.flatMap((resource) => resource.occurrences.map(({ id }) => id)))
}

function captureBackfilledUserResources(sessionId: SessionId, projected: ProjectedResourceMessage) {
  return Effect.gen(function* () {
    const { message, nodeId, branchId } = projected
    const runId = `backfill:${nodeId}`
    const attachments = message.parts.filter((part) => part.type === 'attachment')
    for (const [index, part] of attachments.entries()) {
      yield* captureAttachment({
        sessionId,
        runId,
        attachment: part.attachment,
        index,
        nodeId,
        createdAt: message.createdAt,
        branchId,
      }).pipe(Effect.catchAll(() => Effect.void))
    }
    const links = collectExplicitResources(message.parts).links
    for (const [index, link] of links.entries()) {
      yield* captureLink({
        sessionId,
        runId,
        link,
        index,
        nodeId,
        actor: 'user',
        activity: 'provided',
        createdAt: message.createdAt,
        branchId,
      }).pipe(Effect.catchAll(() => Effect.void))
    }
  })
}

function captureBackfilledAssistantResources(
  sessionId: SessionId,
  projected: ProjectedResourceMessage,
  imageState: BackfillImageState,
  linkState: BackfillLinkState,
) {
  return Effect.gen(function* () {
    const { message, nodeId, branchId } = projected
    const runId = `backfill:${nodeId}`
    const captured = collectExplicitResources(message.parts)
    for (const [index, image] of captured.images.entries()) {
      const imageInput = {
        sessionId,
        runId,
        image,
        index,
        nodeId,
        createdAt: message.createdAt,
        branchId,
      }
      const slot = generatedImageOccurrencePrefix(imageInput)
      if (imageState.capturedSlots.has(slot)) continue
      const prepared = prepareGeneratedImageForCapture(imageState.budget, image)
      if (!prepared) continue
      imageState.budget = prepared.budget
      imageState.capturedSlots.add(slot)
      yield* captureGeneratedImage({ ...imageInput, validatedImage: prepared.image }).pipe(
        Effect.catchAll(() => Effect.void),
      )
    }
    for (const [index, link] of captured.links.entries()) {
      const linkInput = {
        sessionId,
        runId,
        link,
        index,
        nodeId,
        actor: 'agent',
        activity: 'read',
        createdAt: message.createdAt,
        branchId,
      } as const
      const id = linkOccurrenceId(linkInput)
      if (linkState.capturedOccurrences.has(id)) continue
      if (linkState.count >= ASSISTANT_LINK_CAPTURE_LIMIT) break
      linkState.count += 1
      linkState.capturedOccurrences.add(id)
      yield* captureLink(linkInput).pipe(Effect.catchAll(() => Effect.void))
    }
  })
}

/** Rebuilds explicit resources with deterministic, idempotent occurrence ids. */
export function captureProjectedSessionResources(input: {
  readonly sessionId: SessionId
  readonly messages?: readonly Message[]
  readonly nodes?: readonly SessionNode[]
}) {
  return withSessionResourceLock(
    input.sessionId,
    Effect.gen(function* () {
      const repository = yield* SessionResourceRepository
      const resources = yield* repository.list(input.sessionId)
      const imageState: BackfillImageState = {
        budget: { bytes: 0, count: 0 },
        capturedSlots: capturedGeneratedImageSlots(resources),
      }
      const linkState: BackfillLinkState = {
        count: 0,
        capturedOccurrences: capturedOccurrenceIds(resources),
      }
      for (const projected of projectResourceMessages(input)) {
        const { message } = projected
        if (message.role === 'user') {
          yield* captureBackfilledUserResources(input.sessionId, projected)
          continue
        }
        if (message.role !== 'assistant') continue
        yield* captureBackfilledAssistantResources(
          input.sessionId,
          projected,
          imageState,
          linkState,
        )
      }
    }),
  )
}
