import type { Message } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { SessionNode } from '@shared/types/session'
import type { SessionResource } from '@shared/types/session-resource'
import { resolveSessionWorkingDir } from '@shared/utils/worktree'
import * as Effect from 'effect/Effect'
import { SessionRepository } from '../ports/session-repository'
import { SessionResourceRepository } from '../ports/session-resource-repository'
import { SessionResourceStore } from '../ports/session-resource-store'
import {
  attemptBackfilledImage,
  type BackfillImageState,
  type BackfillToolState,
  captureBackfilledAssistantResources,
} from './session-resource-backfill-assistant'
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
import { captureAttachment } from './session-resource-capture'
import {
  attachmentOccurrenceId,
  type CaptureAttachmentInput,
} from './session-resource-capture-attachment'
import { collectExplicitResources } from './session-resource-extraction'
import { withSessionResourceInvalidation } from './session-resource-invalidation'
import { withSessionResourceLock } from './session-resource-lock'

interface BackfillAttachmentState {
  budget: BackfillAttachmentBudget
  readonly completedOccurrences: Set<string>
  readonly knownResources: ReadonlyMap<string, SessionResource>
  readonly retryUnavailableResourceId: string | null
  readonly deferred: AttachmentRepairs.DeferredAttachmentRepair[]
  projectionBlocked: boolean
  progressed: boolean
}

interface BackfillProgress {
  readonly completedAttachmentOccurrences: Set<string>
  readonly knownAttachmentResources: Map<string, SessionResource>
  readonly completedImageSlots: Set<string>
  readonly knownImageSlots: Set<string>
  readonly knownImageResources: Map<string, SessionResource>
}

interface BackfillCaptureState {
  readonly attachments: BackfillAttachmentState
  readonly images: BackfillImageState
  readonly links: BackfillLinkState
  readonly tools: BackfillToolState
}

interface CaptureProjectedSessionResourcesInput {
  readonly sessionId: SessionId
  readonly messages?: readonly Message[]
  readonly nodes?: readonly SessionNode[]
  readonly retryUnavailableResourceId?: string
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

function createBackfillCaptureState(
  resources: readonly SessionResource[],
  progress: BackfillProgress,
  retryUnavailableResourceId: string | undefined,
): BackfillCaptureState {
  const occurrenceIds = capturedOccurrenceIds(resources)
  return {
    attachments: {
      budget: { bytes: 0, count: 0 },
      completedOccurrences: progress.completedAttachmentOccurrences,
      knownResources: progress.knownAttachmentResources,
      retryUnavailableResourceId: retryUnavailableResourceId ?? null,
      deferred: [],
      projectionBlocked: false,
      progressed: false,
    },
    images: {
      budget: { bytes: 0, count: 0, attempts: 0 },
      completedSlots: progress.completedImageSlots,
      knownSlots: progress.knownImageSlots,
      knownResources: progress.knownImageResources,
      deferred: [],
      projectionBlocked: false,
      progressed: false,
    },
    links: {
      count: 0,
      capturedOccurrences: occurrenceIds,
      projectionBlocked: false,
      progressed: false,
    },
    tools: {
      count: 0,
      capturedOccurrences: occurrenceIds,
      projectionBlocked: false,
      progressed: false,
    },
  }
}

function captureBackfilledMessages(
  input: CaptureProjectedSessionResourcesInput,
  state: BackfillCaptureState,
  workingPath: string | null,
) {
  return Effect.gen(function* () {
    for (const projected of projectResourceMessages(input)) {
      const { message } = projected
      if (message.role === 'user') {
        yield* captureBackfilledUserResources(
          input.sessionId,
          projected,
          state.attachments,
          state.links,
        )
        continue
      }
      if (message.role !== 'assistant') continue
      yield* captureBackfilledAssistantResources(
        input.sessionId,
        projected,
        state.images,
        state.links,
        state.tools,
        workingPath,
      )
    }
  })
}

function repairDeferredResources(state: BackfillCaptureState) {
  return Effect.gen(function* () {
    const repairedAttachmentResourceIds = new Set<string>()
    for (const deferred of AttachmentRepairs.orderDeferredAttachmentRepairs(
      state.attachments.deferred,
    )) {
      if (state.attachments.projectionBlocked) break
      if (repairedAttachmentResourceIds.has(deferred.resource.id)) continue
      const repaired = yield* attemptAttachment(
        deferred.input,
        state.attachments,
        deferred.resource,
      )
      if (repaired) repairedAttachmentResourceIds.add(deferred.resource.id)
    }
    for (const deferred of state.images.deferred) {
      yield* attemptBackfilledImage(deferred, state.images)
    }
  })
}

function summarizeBackfill(state: BackfillCaptureState) {
  return {
    progressed:
      state.attachments.progressed ||
      state.images.progressed ||
      state.links.progressed ||
      state.tools.progressed,
    fullyProjected:
      !state.attachments.projectionBlocked &&
      !state.images.projectionBlocked &&
      !state.links.projectionBlocked &&
      !state.tools.projectionBlocked,
  }
}

/** Rebuilds explicit resources with deterministic, idempotent occurrence ids. */
export function captureProjectedSessionResources(input: CaptureProjectedSessionResourcesInput) {
  return withSessionResourceLock(
    input.sessionId,
    withSessionResourceInvalidation(
      input.sessionId,
      Effect.gen(function* () {
        const repository = yield* SessionResourceRepository
        const store = yield* SessionResourceStore
        const sessions = yield* SessionRepository
        const workspace = yield* sessions
          .getWorkspace(input.sessionId)
          .pipe(Effect.catchAll(() => Effect.succeed(null)))
        const session = workspace?.tree.session ?? null
        const workingPath = resolveSessionWorkingDir(session, session?.projectPath ?? null)
        const resources = yield* repository.list(input.sessionId)
        const progress = yield* loadSessionResourceBackfillProgress(
          resources,
          repository,
          store,
          input.sessionId,
        )
        const state = createBackfillCaptureState(
          resources,
          progress,
          input.retryUnavailableResourceId,
        )
        yield* captureBackfilledMessages(input, state, workingPath)
        yield* repairDeferredResources(state)
        return summarizeBackfill(state)
      }),
    ),
  )
}

export {
  ATTACHMENT_BACKFILL_LIMITS,
  advanceAttachmentBackfillBudget,
} from './session-resource-backfill-budget'
