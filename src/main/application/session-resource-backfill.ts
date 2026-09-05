import type { Message } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { SessionNode } from '@shared/types/session'
import type { SessionResource } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import { SessionResourceRepository } from '../ports/session-resource-repository'
import { SessionResourceStore } from '../ports/session-resource-store'
import * as AttachmentRepairs from './session-resource-backfill-attachment-repairs'
import {
  advanceAttachmentBackfillBudget,
  type BackfillAttachmentBudget,
  isBackfillableAttachmentSize,
} from './session-resource-backfill-budget'
import { type BackfillLinkState, captureBackfilledLinks } from './session-resource-backfill-link'
import {
  type ProjectedResourceMessage,
  projectResourceMessages,
} from './session-resource-backfill-messages'
import { loadSessionResourceBackfillProgress } from './session-resource-backfill-progress'
import {
  captureAttachment,
  captureGeneratedImage,
  type GeneratedImageCaptureBudget,
  prepareGeneratedImageForCapture,
} from './session-resource-capture'
import {
  attachmentOccurrenceId,
  type CaptureAttachmentInput,
} from './session-resource-capture-attachment'
import {
  captureUnavailableGeneratedImage,
  generatedImageOccurrencePrefix,
} from './session-resource-capture-image'
import { type CapturedImage, collectExplicitResources } from './session-resource-extraction'
import { withSessionResourceLock } from './session-resource-lock'

interface BackfillImageState {
  budget: GeneratedImageCaptureBudget
  readonly completedSlots: Set<string>
  readonly knownSlots: Set<string>
  readonly knownResources: ReadonlyMap<string, SessionResource>
  readonly deferred: BackfillImageInput[]
  projectionBlocked: boolean
  progressed: boolean
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
  readonly retryUnavailableResourceId: string | null
  readonly deferred: AttachmentRepairs.DeferredAttachmentRepair[]
  projectionBlocked: boolean
  progressed: boolean
}

function capturedOccurrenceIds(resources: readonly SessionResource[]) {
  return new Set(resources.flatMap((resource) => resource.occurrences.map(({ id }) => id)))
}

function attemptAttachment(
  input: CaptureAttachmentInput,
  state: BackfillAttachmentState,
  repairResource?: SessionResource,
) {
  return Effect.gen(function* () {
    const id = attachmentOccurrenceId(input)
    const nextBudget = advanceAttachmentBackfillBudget(state.budget, input.attachment.sizeBytes)
    if (!nextBudget) {
      if (repairResource) {
        state.projectionBlocked = true
        return false
      }
      if (!isBackfillableAttachmentSize(input.attachment.sizeBytes)) {
        yield* captureAttachment(input)
        state.completedOccurrences.add(id)
        state.progressed = true
        return false
      }
      state.projectionBlocked = true
      return false
    }
    state.budget = nextBudget
    const repaired = yield* captureAttachment({
      ...input,
      ...(repairResource ? { repairResource } : {}),
    })
    state.completedOccurrences.add(id)
    state.progressed = true
    return repaired
  })
}

function attemptBackfilledImage(input: BackfillImageInput, state: BackfillImageState) {
  return Effect.gen(function* () {
    const prepared = prepareGeneratedImageForCapture(state.budget, input.image)
    if (!prepared) {
      state.projectionBlocked = true
      return
    }
    state.budget = prepared.budget
    const slot = generatedImageOccurrencePrefix(input)
    if (!prepared.image) {
      if (prepared.byteBudgetExceeded) {
        state.projectionBlocked = true
        return
      }
      yield* captureUnavailableGeneratedImage(input)
      state.knownSlots.add(slot)
      state.progressed = true
      return
    }
    yield* captureGeneratedImage({ ...input, validatedImage: prepared.image })
    state.completedSlots.add(slot)
    state.knownSlots.add(slot)
    state.progressed = true
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
        if (!knownResource.available) {
          if (knownResource.id === attachmentState.retryUnavailableResourceId) {
            attachmentState.deferred.push({ input: attachmentInput, resource: knownResource })
          }
          continue
        }
        attachmentState.deferred.push({ input: attachmentInput, resource: knownResource })
        continue
      }
      yield* attemptAttachment(attachmentInput, attachmentState)
    }
    yield* captureBackfilledLinks({
      sessionId,
      runId,
      links: collectExplicitResources(message.parts).links,
      nodeId,
      actor: 'user',
      activity: 'provided',
      createdAt: message.createdAt,
      branchId,
      state: linkState,
    })
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
        if (imageState.knownResources.get(slot)?.available === false) continue
        imageState.deferred.push(imageInput)
        continue
      }
      yield* attemptBackfilledImage(imageInput, imageState)
    }
    yield* captureBackfilledLinks({
      sessionId,
      runId,
      links: captured.links,
      nodeId,
      actor: 'agent',
      activity: 'read',
      createdAt: message.createdAt,
      branchId,
      state: linkState,
    })
  })
}

/** Rebuilds explicit resources with deterministic, idempotent occurrence ids. */
export function captureProjectedSessionResources(input: {
  readonly sessionId: SessionId
  readonly messages?: readonly Message[]
  readonly nodes?: readonly SessionNode[]
  readonly retryUnavailableResourceId?: string
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
        retryUnavailableResourceId: input.retryUnavailableResourceId ?? null,
        deferred: [],
        projectionBlocked: false,
        progressed: false,
      }
      const imageState: BackfillImageState = {
        budget: { bytes: 0, count: 0, attempts: 0 },
        completedSlots: progress.completedImageSlots,
        knownSlots: progress.knownImageSlots,
        knownResources: progress.knownImageResources,
        deferred: [],
        projectionBlocked: false,
        progressed: false,
      }
      const linkState: BackfillLinkState = {
        count: 0,
        capturedOccurrences: capturedOccurrenceIds(resources),
        projectionBlocked: false,
        progressed: false,
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
      const repairedAttachmentResourceIds = new Set<string>()
      for (const deferred of AttachmentRepairs.orderDeferredAttachmentRepairs(
        attachmentState.deferred,
      )) {
        if (attachmentState.projectionBlocked) break
        if (repairedAttachmentResourceIds.has(deferred.resource.id)) continue
        const repaired = yield* attemptAttachment(
          deferred.input,
          attachmentState,
          deferred.resource,
        )
        if (repaired) repairedAttachmentResourceIds.add(deferred.resource.id)
      }
      for (const deferred of imageState.deferred) {
        yield* attemptBackfilledImage(deferred, imageState)
      }
      return {
        progressed: attachmentState.progressed || imageState.progressed || linkState.progressed,
        fullyProjected:
          !attachmentState.projectionBlocked &&
          !imageState.projectionBlocked &&
          !linkState.projectionBlocked,
      }
    }),
  )
}
