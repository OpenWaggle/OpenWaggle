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
  readonly deferred: Array<{
    readonly input: CaptureAttachmentInput
    readonly resource: SessionResource
  }>
  projectionBlocked: boolean
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
    if (!nextBudget) {
      if (repairResource) {
        state.projectionBlocked = true
        return
      }
      if (!isBackfillableAttachmentSize(input.attachment.sizeBytes)) {
        yield* captureAttachment(input)
        state.completedOccurrences.add(id)
        return
      }
      state.projectionBlocked = true
      return
    }
    state.budget = nextBudget
    yield* captureAttachment({
      ...input,
      ...(repairResource ? { repairResource } : {}),
    })
    state.completedOccurrences.add(id)
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
      yield* attemptBackfilledAttachment(attachmentInput, attachmentState)
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

/** Rebuilds explicit resources with deterministic, idempotent occurrence ids. */
export function captureProjectedSessionResources(input: {
  readonly sessionId: SessionId
  readonly messages?: readonly Message[]
  readonly nodes?: readonly SessionNode[]
  readonly retryUnavailableResourceId?: string
}) {
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
        const attachmentState: BackfillAttachmentState = {
          budget: { bytes: 0, count: 0 },
          completedOccurrences: progress.completedAttachmentOccurrences,
          knownResources: progress.knownAttachmentResources,
          retryUnavailableResourceId: input.retryUnavailableResourceId ?? null,
          deferred: [],
          projectionBlocked: false,
        }
        const imageState: BackfillImageState = {
          budget: { bytes: 0, count: 0, attempts: 0 },
          completedSlots: progress.completedImageSlots,
          knownSlots: progress.knownImageSlots,
          knownResources: progress.knownImageResources,
          deferred: [],
          projectionBlocked: false,
        }
        const linkState: BackfillLinkState = {
          count: 0,
          capturedOccurrences: capturedOccurrenceIds(resources),
          projectionBlocked: false,
        }
        const toolState: BackfillToolState = {
          count: 0,
          capturedOccurrences: capturedOccurrenceIds(resources),
          projectionBlocked: false,
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
            toolState,
            workingPath,
          )
        }
        for (const deferred of attachmentState.deferred) {
          yield* attemptBackfilledAttachment(deferred.input, attachmentState, deferred.resource)
        }
        for (const deferred of imageState.deferred) {
          yield* attemptBackfilledImage(deferred, imageState)
        }
        return {
          fullyProjected:
            !attachmentState.projectionBlocked &&
            !imageState.projectionBlocked &&
            !linkState.projectionBlocked &&
            !toolState.projectionBlocked,
        }
      }),
    ),
  )
}

export {
  ATTACHMENT_BACKFILL_LIMITS,
  advanceAttachmentBackfillBudget,
} from './session-resource-backfill-budget'
