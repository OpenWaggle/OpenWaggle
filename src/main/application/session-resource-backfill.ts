import { ATTACHMENT } from '@shared/constants/resource-limits'
import type { Message } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { SessionNode } from '@shared/types/session'
import type { SessionResource } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import { SessionResourceRepository } from '../ports/session-resource-repository'
import { SessionResourceStore } from '../ports/session-resource-store'
import {
  captureAttachment,
  captureGeneratedImage,
  captureLink,
  type GeneratedImageCaptureBudget,
  prepareGeneratedImageForCapture,
  SESSION_LINK_CAPTURE_LIMIT,
} from './session-resource-capture'
import { attachmentOccurrenceId } from './session-resource-capture-attachment'
import { generatedImageOccurrencePrefix } from './session-resource-capture-image'
import { linkOccurrenceId } from './session-resource-capture-link'
import { inspectManagedCopy } from './session-resource-capture-shared'
import { collectExplicitResources } from './session-resource-extraction'
import { withSessionResourceLock } from './session-resource-lock'

interface ProjectedResourceMessage {
  readonly message: Message
  readonly nodeId: string
  readonly branchId: string | null
}

interface BackfillImageState {
  budget: GeneratedImageCaptureBudget
  readonly capturedSlots: Set<string>
}

export const ATTACHMENT_BACKFILL_LIMITS = {
  maxBytes: ATTACHMENT.MAX_TOTAL_SIZE_BYTES,
  maxCount: 16,
} as const

interface BackfillAttachmentBudget {
  readonly bytes: number
  readonly count: number
}

interface BackfillAttachmentState {
  budget: BackfillAttachmentBudget
  readonly capturedOccurrences: Set<string>
}

export function advanceAttachmentBackfillBudget(
  current: BackfillAttachmentBudget,
  byteLength: number,
): BackfillAttachmentBudget | null {
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0 ||
    byteLength > ATTACHMENT.MAX_SIZE_BYTES ||
    current.count >= ATTACHMENT_BACKFILL_LIMITS.maxCount ||
    current.bytes > ATTACHMENT_BACKFILL_LIMITS.maxBytes - byteLength
  ) {
    return null
  }
  return { bytes: current.bytes + byteLength, count: current.count + 1 }
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

function capturedGeneratedImageSlots(
  resources: readonly SessionResource[],
  repository: Parameters<typeof inspectManagedCopy>[0],
  store: Parameters<typeof inspectManagedCopy>[1],
  sessionId: SessionId,
) {
  return Effect.gen(function* () {
    const slots = new Set<string>()
    for (const resource of resources) {
      const occurrenceSlots = resource.occurrences.flatMap((occurrence) => {
        if (!occurrence.id.includes(':created:image:')) return []
        const separator = occurrence.id.lastIndexOf(':')
        return separator === -1 ? [] : [occurrence.id.slice(0, separator + 1)]
      })
      if (occurrenceSlots.length === 0 || !resource.available) continue
      const copy = yield* inspectManagedCopy(repository, store, sessionId, resource.id)
      if (!copy?.readable) continue
      for (const slot of occurrenceSlots) slots.add(slot)
    }
    return slots
  })
}

function capturedOccurrenceIds(resources: readonly SessionResource[]) {
  return new Set(resources.flatMap((resource) => resource.occurrences.map(({ id }) => id)))
}

function capturedAvailableOccurrenceIds(resources: readonly SessionResource[]) {
  return new Set(
    resources.flatMap((resource) =>
      resource.available ? resource.occurrences.map(({ id }) => id) : [],
    ),
  )
}

function captureBackfilledUserResources(
  sessionId: SessionId,
  projected: ProjectedResourceMessage,
  attachmentState: BackfillAttachmentState,
  linkState: BackfillLinkState,
) {
  return Effect.gen(function* () {
    const { message, nodeId, branchId } = projected
    const runId = `backfill:${nodeId}`
    const attachments = message.parts.filter((part) => part.type === 'attachment')
    for (const [index, part] of attachments.entries()) {
      const attachmentInput = {
        sessionId,
        runId,
        attachment: part.attachment,
        index,
        nodeId,
        createdAt: message.createdAt,
        branchId,
      }
      const id = attachmentOccurrenceId(attachmentInput)
      if (attachmentState.capturedOccurrences.has(id)) continue
      const nextBudget = advanceAttachmentBackfillBudget(
        attachmentState.budget,
        part.attachment.sizeBytes,
      )
      if (!nextBudget) continue
      attachmentState.budget = nextBudget
      const captured = yield* captureAttachment(attachmentInput).pipe(
        Effect.as(true),
        Effect.catchAll(() => Effect.succeed(false)),
      )
      if (captured) attachmentState.capturedOccurrences.add(id)
    }
    const links = collectExplicitResources(message.parts).links
    for (const [index, link] of links.entries()) {
      const linkInput = {
        sessionId,
        runId,
        link,
        index,
        nodeId,
        actor: 'user',
        activity: 'provided',
        createdAt: message.createdAt,
        branchId,
      } as const
      const id = linkOccurrenceId(linkInput)
      if (linkState.capturedOccurrences.has(id)) continue
      if (linkState.count >= SESSION_LINK_CAPTURE_LIMIT) break
      linkState.count += 1
      linkState.capturedOccurrences.add(id)
      yield* captureLink(linkInput).pipe(Effect.catchAll(() => Effect.void))
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
      if (!prepared) break
      imageState.budget = prepared.budget
      if (!prepared.image) continue
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
      if (linkState.count >= SESSION_LINK_CAPTURE_LIMIT) break
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
      const store = yield* SessionResourceStore
      const resources = yield* repository.list(input.sessionId)
      const attachmentState: BackfillAttachmentState = {
        budget: { bytes: 0, count: 0 },
        capturedOccurrences: capturedAvailableOccurrenceIds(resources),
      }
      const imageState: BackfillImageState = {
        budget: { bytes: 0, count: 0, attempts: 0 },
        capturedSlots: yield* capturedGeneratedImageSlots(
          resources,
          repository,
          store,
          input.sessionId,
        ),
      }
      const linkState: BackfillLinkState = {
        count: 0,
        capturedOccurrences: capturedOccurrenceIds(resources),
      }
      for (const projected of projectResourceMessages(input)) {
        const { message } = projected
        if (message.role === 'user') {
          yield* captureBackfilledUserResources(
            input.sessionId,
            projected,
            attachmentState,
            linkState,
          )
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
