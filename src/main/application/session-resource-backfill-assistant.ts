import type { SessionId } from '@shared/types/brand'
import type { SessionResource, SessionResourceActor } from '@shared/types/session-resource'
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
}

export interface BackfillToolState {
  count: number
  readonly capturedOccurrences: Set<string>
  projectionBlocked: boolean
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
      return
    }
    yield* captureGeneratedImage({ ...input, validatedImage: prepared.image })
    state.completedSlots.add(slot)
    state.knownSlots.add(slot)
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
      const groups = toolResultOutputGroups(part.toolResult)
      if (groups.length === 0) continue
      const toolOccurrence = toolResultOccurrenceId({
        sessionId,
        nodeId,
        toolResult: part.toolResult,
      })
      if (!toolState.capturedOccurrences.has(toolOccurrence)) {
        if (toolState.count >= SESSION_TOOL_CAPTURE_LIMIT) {
          toolState.projectionBlocked = true
          continue
        }
        toolState.count += 1
      }
      yield* captureToolResultMetadata({
        sessionId,
        toolResult: part.toolResult,
        nodeId,
        branchId,
        workingPath,
        createdAt: message.createdAt,
      }).pipe(Effect.catchAll(() => Effect.void))
      toolState.capturedOccurrences.add(toolOccurrence)
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
