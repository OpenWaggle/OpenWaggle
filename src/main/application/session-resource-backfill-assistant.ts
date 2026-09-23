import type { SessionId } from '@shared/types/brand'
import type { SessionResource, SessionResourceActor } from '@shared/types/session-resource'
import type { ToolCallResult } from '@shared/types/tools'
import * as Effect from 'effect/Effect'
import { SessionResourceRepository } from '../ports/session-resource-repository'
import { type BackfillLinkState, captureBackfilledLinks } from './session-resource-backfill-link'
import type { ProjectedResourceMessage } from './session-resource-backfill-messages'
import {
  captureGeneratedImage,
  captureUnavailableGeneratedImage,
  generatedImageOccurrencePrefix,
} from './session-resource-capture-image'
import {
  type GeneratedImageCaptureBudget,
  prepareGeneratedImageForCapture,
} from './session-resource-capture-image-budget'
import {
  capturedImageSourcePath,
  generatedImageInput,
  prepareLocalImageForCapture,
} from './session-resource-capture-image-preparation'
import { sha256 } from './session-resource-capture-shared'
import {
  captureToolResultMetadata,
  SESSION_TOOL_CAPTURE_LIMIT,
  toolResultCompletionOccurrenceIds,
  toolResultOccurrenceId,
  toolResultOutputGroups,
} from './session-resource-capture-tool'
import type { CapturedImage, collectExplicitResources } from './session-resource-extraction'
import { assistantMessageResourcePlan } from './session-resource-image-positions'

export interface BackfillImageInput {
  readonly sessionId: SessionId
  readonly runId: string
  readonly image: CapturedImage
  readonly index: number
  readonly nodeId: string
  readonly createdAt: number
  readonly branchId: string | null
  readonly actor: SessionResourceActor
  readonly label: string | null
  readonly displayOrder?: number | null
}

interface DeferredBackfillImage {
  readonly input: BackfillImageInput
  readonly repairResource?: SessionResource
}

export interface BackfillImageState {
  budget: GeneratedImageCaptureBudget
  readonly completedSlots: Set<string>
  readonly knownSlots: Set<string>
  readonly knownResources: ReadonlyMap<string, SessionResource>
  readonly retryUnavailableResourceId: string | null
  readonly deferred: DeferredBackfillImage[]
  readonly localImageRoots: readonly string[]
  projectionBlocked: boolean
  progressed: boolean
}

export interface BackfillToolState {
  count: number
  readonly capturedOccurrences: Set<string>
  projectionBlocked: boolean
  progressed: boolean
}

export function attemptBackfilledImage(
  input: BackfillImageInput,
  state: BackfillImageState,
  repairResource?: SessionResource,
) {
  return Effect.gen(function* () {
    const prepared =
      'data' in input.image
        ? prepareGeneratedImageForCapture(state.budget, input.image)
        : yield* prepareLocalImageForCapture(state.budget, input.image, state.localImageRoots)
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
    yield* captureGeneratedImage({
      ...input,
      image: generatedImageInput(input.image),
      validatedImage: prepared.image,
      sourcePath: capturedImageSourcePath(input.image),
    })
    if (repairResource) {
      const repository = yield* SessionResourceRepository
      yield* repository.rekey({
        sessionId: input.sessionId,
        resourceId: repairResource.id,
        canonicalKey: `sha256:${sha256(prepared.image.bytes)}`,
        updatedAt: input.createdAt,
      })
    }
    state.completedSlots.add(slot)
    state.knownSlots.add(slot)
    state.progressed = true
  })
}

function captureOrDeferBackfilledImage(input: BackfillImageInput, state: BackfillImageState) {
  return Effect.gen(function* () {
    const slot = generatedImageOccurrencePrefix(input)
    if (state.completedSlots.has(slot)) return
    if (state.knownSlots.has(slot)) {
      const knownResource = state.knownResources.get(slot)
      if (knownResource?.available === false) {
        if (knownResource.id === state.retryUnavailableResourceId) {
          state.deferred.push({ input, repairResource: knownResource })
        }
        return
      }
      state.deferred.push({ input })
      return
    }
    yield* attemptBackfilledImage(input, state)
  })
}

function toolResultAlreadyCaptured(
  state: BackfillToolState,
  occurrenceId: string,
  completionOccurrenceIds: readonly string[],
) {
  return (
    state.capturedOccurrences.has(occurrenceId) ||
    (completionOccurrenceIds.length > 0 &&
      completionOccurrenceIds.every((id) => state.capturedOccurrences.has(id)))
  )
}

function captureBackfilledToolMetadata(input: {
  readonly sessionId: SessionId
  readonly nodeId: string
  readonly branchId: string | null
  readonly toolResult: ToolCallResult
  readonly createdAt: number
  readonly workingPath: string | null
  readonly state: BackfillToolState
}) {
  return Effect.gen(function* () {
    const groups = toolResultOutputGroups(input.toolResult)
    if (groups.length === 0) return null
    const toolOccurrence = toolResultOccurrenceId(input)
    const completionOccurrences = toolResultCompletionOccurrenceIds(input)
    if (!toolResultAlreadyCaptured(input.state, toolOccurrence, completionOccurrences)) {
      if (input.state.count >= SESSION_TOOL_CAPTURE_LIMIT) {
        input.state.projectionBlocked = true
        return null
      }
      input.state.count += 1
    }
    const captured = yield* captureToolResultMetadata(input).pipe(Effect.option)
    if (captured._tag === 'None') {
      input.state.projectionBlocked = true
      return null
    }
    input.state.capturedOccurrences.add(toolOccurrence)
    for (const id of completionOccurrences) input.state.capturedOccurrences.add(id)
    input.state.progressed = true
    return groups
  })
}

export function captureBackfilledAssistantResources(
  sessionId: SessionId,
  projected: ProjectedResourceMessage,
  imageState: BackfillImageState,
  linkState: BackfillLinkState,
  toolState: BackfillToolState,
  workingPath: string | null,
) {
  return Effect.gen(function* () {
    const { message, nodeId, branchId } = projected
    const runId = `backfill:${nodeId}`
    let imageIndex = 0
    let linkIndex = 0
    const plan = assistantMessageResourcePlan(message)

    function reserveGroup(captured: ReturnType<typeof collectExplicitResources>) {
      imageIndex += captured.images.length
      linkIndex += captured.links.length
    }

    function captureGroup(
      captured: ReturnType<typeof collectExplicitResources>,
      actor: SessionResourceActor,
      label: string | null,
      positions: {
        readonly images: readonly (number | null)[]
        readonly links: readonly (number | null)[]
      },
    ) {
      return Effect.gen(function* () {
        for (const [localIndex, image] of captured.images.entries()) {
          yield* captureOrDeferBackfilledImage(
            {
              sessionId,
              runId,
              image,
              index: imageIndex + localIndex,
              nodeId,
              createdAt: message.createdAt,
              branchId,
              actor,
              label,
              displayOrder: positions.images[localIndex],
            },
            imageState,
          )
        }
        imageIndex += captured.images.length
        yield* captureBackfilledLinks({
          sessionId,
          runId,
          links: captured.links,
          nodeId,
          actor,
          activity: 'read',
          label,
          createdAt: message.createdAt,
          branchId,
          indexOffset: linkIndex,
          displayOrders: positions.links,
          state: linkState,
        })
        linkIndex += captured.links.length
      })
    }

    for (const planned of plan.toolResults) {
      const groups = yield* captureBackfilledToolMetadata({
        sessionId,
        nodeId,
        branchId,
        toolResult: planned.toolResult,
        createdAt: message.createdAt,
        workingPath,
        state: toolState,
      })
      if (!groups) {
        // Deferred tool groups still reserve their stable occurrence and display slots.
        for (const group of planned.groups) {
          reserveGroup(group.resources)
        }
        continue
      }
      for (const [index, group] of groups.entries()) {
        const plannedGroup = planned.groups[index]
        if (!plannedGroup) continue
        yield* captureGroup(plannedGroup.resources, 'tool', group.label, plannedGroup.positions)
      }
    }
    yield* captureGroup(plan.textResources, 'agent', null, plan.textPositions)
  })
}
