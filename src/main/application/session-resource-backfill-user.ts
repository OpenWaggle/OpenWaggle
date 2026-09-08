import type { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import type * as AttachmentRepairs from './session-resource-backfill-attachment-repairs'
import {
  advanceAttachmentBackfillBudget,
  type BackfillAttachmentBudget,
  isBackfillableAttachmentSize,
} from './session-resource-backfill-budget'
import { type BackfillLinkState, captureBackfilledLinks } from './session-resource-backfill-link'
import type { ProjectedResourceMessage } from './session-resource-backfill-messages'
import { captureAttachment } from './session-resource-capture'
import {
  attachmentOccurrenceId,
  type CaptureAttachmentInput,
} from './session-resource-capture-attachment'
import { collectExplicitResources } from './session-resource-extraction'

export interface BackfillAttachmentState {
  budget: BackfillAttachmentBudget
  readonly completedOccurrences: Set<string>
  readonly knownResources: ReadonlyMap<string, SessionResource>
  readonly retryUnavailableResourceId: string | null
  readonly deferred: AttachmentRepairs.DeferredAttachmentRepair[]
  projectionBlocked: boolean
  progressed: boolean
}

export function attemptBackfilledAttachment(
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

export function captureBackfilledUserResources(
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
