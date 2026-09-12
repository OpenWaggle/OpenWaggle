import type { SessionId } from '@shared/types/brand'
import type { SessionResource, SessionResourceActor } from '@shared/types/session-resource'
import type { ToolCallResult } from '@shared/types/tools'
import * as Effect from 'effect/Effect'
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
  captureToolResultMetadata,
  SESSION_TOOL_CAPTURE_LIMIT,
  toolResultCompletionOccurrenceIds,
  toolResultOccurrenceId,
  toolResultOutputGroups,
} from './session-resource-capture-tool'
import { type CapturedImage, collectExplicitResources } from './session-resource-extraction'

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
}

export interface BackfillImageState {
  budget: GeneratedImageCaptureBudget
  readonly completedSlots: Set<string>
  readonly knownSlots: Set<string>
  readonly knownResources: ReadonlyMap<string, SessionResource>
  readonly deferred: BackfillImageInput[]
  projectionBlocked: boolean
  progressed: boolean
}

export interface BackfillToolState {
  count: number
  readonly capturedOccurrences: Set<string>
  projectionBlocked: boolean
  progressed: boolean
}

export function attemptBackfilledImage(input: BackfillImageInput, state: BackfillImageState) {
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

function captureOrDeferBackfilledImage(input: BackfillImageInput, state: BackfillImageState) {
  return Effect.gen(function* () {
    const slot = generatedImageOccurrencePrefix(input)
    if (state.completedSlots.has(slot)) return
    if (state.knownSlots.has(slot)) {
      if (state.knownResources.get(slot)?.available === false) return
      state.deferred.push(input)
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
    for (const part of message.parts) {
      if (part.type !== 'tool-result') continue
      const groups = yield* captureBackfilledToolMetadata({
        sessionId,
        nodeId,
        branchId,
        toolResult: part.toolResult,
        createdAt: message.createdAt,
        workingPath,
        state: toolState,
      })
      if (!groups) {
        // A deferred metadata write must not renumber later persisted image/link occurrences.
        for (const group of toolResultOutputGroups(part.toolResult)) {
          const deferred = collectExplicitResources(group.result)
          imageIndex += deferred.images.length
          linkIndex += deferred.links.length
        }
        continue
      }
      for (const group of groups) {
        const captured = collectExplicitResources(group.result)
        for (const image of captured.images) {
          yield* captureOrDeferBackfilledImage(
            {
              sessionId,
              runId,
              image,
              index: imageIndex,
              nodeId,
              createdAt: message.createdAt,
              branchId,
              actor: 'tool',
              label: group.label,
            },
            imageState,
          )
          imageIndex += 1
        }
        yield* captureBackfilledLinks({
          sessionId,
          runId,
          links: captured.links,
          nodeId,
          actor: 'tool',
          activity: 'read',
          label: group.label,
          createdAt: message.createdAt,
          branchId,
          indexOffset: linkIndex,
          state: linkState,
        })
        linkIndex += captured.links.length
      }
    }
    const assistantContent = message.parts.filter((part) => part.type === 'text')
    const captured = collectExplicitResources(assistantContent)
    for (const image of captured.images) {
      yield* captureOrDeferBackfilledImage(
        {
          sessionId,
          runId,
          image,
          index: imageIndex,
          nodeId,
          createdAt: message.createdAt,
          branchId,
          actor: 'agent',
          label: null,
        },
        imageState,
      )
      imageIndex += 1
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
      indexOffset: linkIndex,
      state: linkState,
    })
  })
}
