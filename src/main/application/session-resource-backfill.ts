import type { Message } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { SessionNode } from '@shared/types/session'
import type { SessionResource } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import { SessionResourceRepository } from '../ports/session-resource-repository'
import { SessionResourceStore } from '../ports/session-resource-store'
import {
  advanceAttachmentBackfillBudget,
  type BackfillAttachmentBudget,
} from './session-resource-backfill-budget'
import { loadSessionResourceBackfillProgress } from './session-resource-backfill-progress'
import {
  captureAttachment,
  captureGeneratedImage,
  captureLink,
  type GeneratedImageCaptureBudget,
  prepareGeneratedImageForCapture,
  SESSION_LINK_CAPTURE_LIMIT,
} from './session-resource-capture'
import {
  attachmentOccurrenceId,
  type CaptureAttachmentInput,
} from './session-resource-capture-attachment'
import {
  captureUnavailableGeneratedImage,
  generatedImageOccurrencePrefix,
} from './session-resource-capture-image'
import { linkOccurrenceId } from './session-resource-capture-link'
import { type CapturedImage, collectExplicitResources } from './session-resource-extraction'
import { withSessionResourceLock } from './session-resource-lock'

interface ProjectedResourceMessage {
  readonly message: Message
  readonly nodeId: string
  readonly branchId: string | null
}

interface BackfillImageState {
  budget: GeneratedImageCaptureBudget
  readonly completedSlots: Set<string>
  readonly knownSlots: Set<string>
  readonly deferred: BackfillImageInput[]
}

interface BackfillImageInput {
  readonly sessionId: SessionId
  readonly runId: string
  readonly image: CapturedImage
  readonly index: number
  readonly nodeId: string
  readonly createdAt: number
  readonly branchId: string | null
}

interface BackfillAttachmentState {
  budget: BackfillAttachmentBudget
  readonly completedOccurrences: Set<string>
  readonly knownResources: ReadonlyMap<string, SessionResource>
  readonly deferred: Array<{
    readonly input: CaptureAttachmentInput
    readonly resource: SessionResource
  }>
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

function capturedOccurrenceIds(resources: readonly SessionResource[]) {
  return new Set(resources.flatMap((resource) => resource.occurrences.map(({ id }) => id)))
}

function attemptBackfilledAttachment(
  input: CaptureAttachmentInput,
  state: BackfillAttachmentState,
  repairResource?: SessionResource,
) {
  return Effect.gen(function* () {
    const id = attachmentOccurrenceId(input)
    const nextBudget = advanceAttachmentBackfillBudget(state.budget, input.attachment.sizeBytes)
    if (!nextBudget) return
    state.budget = nextBudget
    yield* captureAttachment({
      ...input,
      ...(repairResource ? { repairResource } : {}),
    }).pipe(Effect.catchAll(() => Effect.void))
    state.completedOccurrences.add(id)
  })
}

function attemptBackfilledImage(input: BackfillImageInput, state: BackfillImageState) {
  return Effect.gen(function* () {
    const prepared = prepareGeneratedImageForCapture(state.budget, input.image)
    if (!prepared) return
    state.budget = prepared.budget
    const slot = generatedImageOccurrencePrefix(input)
    if (!prepared.image) {
      state.knownSlots.add(slot)
      yield* captureUnavailableGeneratedImage(input).pipe(Effect.catchAll(() => Effect.void))
      return
    }
    state.completedSlots.add(slot)
    yield* captureGeneratedImage({ ...input, validatedImage: prepared.image }).pipe(
      Effect.catchAll(() => Effect.void),
    )
  })
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
      if (attachmentState.completedOccurrences.has(id)) continue
      const knownResource = attachmentState.knownResources.get(id)
      if (knownResource) {
        attachmentState.deferred.push({ input: attachmentInput, resource: knownResource })
        continue
      }
      yield* attemptBackfilledAttachment(attachmentInput, attachmentState)
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
      if (imageState.completedSlots.has(slot)) continue
      if (imageState.knownSlots.has(slot)) {
        imageState.deferred.push(imageInput)
        continue
      }
      yield* attemptBackfilledImage(imageInput, imageState)
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
      const progress = yield* loadSessionResourceBackfillProgress(
        resources,
        repository,
        store,
        input.sessionId,
      )
      const attachmentState: BackfillAttachmentState = {
        budget: { bytes: 0, count: 0 },
        completedOccurrences: progress.completedAttachmentOccurrences,
        knownResources: progress.knownAttachmentResources,
        deferred: [],
      }
      const imageState: BackfillImageState = {
        budget: { bytes: 0, count: 0, attempts: 0 },
        completedSlots: progress.completedImageSlots,
        knownSlots: progress.knownImageSlots,
        deferred: [],
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
      for (const deferred of attachmentState.deferred) {
        yield* attemptBackfilledAttachment(deferred.input, attachmentState, deferred.resource)
      }
      for (const deferred of imageState.deferred) {
        yield* attemptBackfilledImage(deferred, imageState)
      }
    }),
  )
}

export {
  ATTACHMENT_BACKFILL_LIMITS,
  advanceAttachmentBackfillBudget,
} from './session-resource-backfill-budget'
