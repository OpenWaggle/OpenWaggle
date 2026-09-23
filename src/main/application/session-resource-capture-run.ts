import { type AgentSendPayload, getMessageText, type Message } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { SessionResourceActivity, SessionResourceActor } from '@shared/types/session-resource'
import { resolveSessionWorkingDir } from '@shared/utils/worktree'
import * as Effect from 'effect/Effect'
import { SessionRepository } from '../ports/session-repository'
export interface AcceptedAgentSteer {
  readonly payload: AgentSendPayload
  readonly durableText: string
}

import { captureGeneratedImage } from './session-resource-capture-image'
import type { GeneratedImageCaptureBudget } from './session-resource-capture-image-budget'
import {
  capturedImageSourcePath,
  generatedImageInput,
  localImageCaptureRoots,
  prepareCapturedImageForCapture,
} from './session-resource-capture-image-preparation'
import { captureLink } from './session-resource-capture-link'
import {
  captureToolResultMetadata,
  SESSION_TOOL_CAPTURE_LIMIT,
} from './session-resource-capture-tool'
import {
  captureUserResources,
  type LinkCaptureState,
  SESSION_LINK_CAPTURE_LIMIT,
} from './session-resource-capture-user'
import type { CapturedImage, CapturedLink } from './session-resource-extraction'
import { assistantMessageResourcePlan } from './session-resource-image-positions'
import { withSessionResourceInvalidation } from './session-resource-invalidation'
import { withSessionResourceLock } from './session-resource-lock'

export { SESSION_LINK_CAPTURE_LIMIT }

interface SuccessfulRunResourceInput {
  readonly sessionId: SessionId
  readonly runId: string
  readonly payload: AgentSendPayload
  readonly messages: readonly Message[]
  readonly nodeIdByMessageId?: Readonly<Record<string, string>>
  readonly branchIdByMessageId?: Readonly<Record<string, string | null>>
  readonly acceptedSteers?: readonly AcceptedAgentSteer[]
}

interface AssistantCaptureState {
  generatedImageBudget: GeneratedImageCaptureBudget
  toolCount: number
  readonly links: LinkCaptureState
  readonly localImageRoots: readonly string[]
}

interface MessageCaptureContext {
  readonly message: Message
  readonly nodeId: string
  readonly branchId: string | null
  imageIndex: number
  linkIndex: number
}

function messageCaptureContext(
  input: SuccessfulRunResourceInput,
  message: Message,
): MessageCaptureContext {
  const messageId = String(message.id)
  return {
    message,
    nodeId: input.nodeIdByMessageId?.[messageId] ?? messageId,
    branchId: input.branchIdByMessageId?.[messageId] ?? null,
    imageIndex: 0,
    linkIndex: 0,
  }
}

function captureImages(input: {
  readonly run: SuccessfulRunResourceInput
  readonly context: MessageCaptureContext
  readonly images: readonly CapturedImage[]
  readonly actor: SessionResourceActor
  readonly label: string | null
  readonly displayOrders: readonly (number | null)[]
  readonly state: AssistantCaptureState
}) {
  return Effect.gen(function* () {
    const startIndex = input.context.imageIndex
    input.context.imageIndex += input.images.length
    for (const [localIndex, image] of input.images.entries()) {
      const index = startIndex + localIndex
      const prepared = yield* prepareCapturedImageForCapture(
        input.state.generatedImageBudget,
        image,
        input.state.localImageRoots,
      )
      if (!prepared) return
      input.state.generatedImageBudget = prepared.budget
      if (!prepared.image) continue
      yield* captureGeneratedImage({
        ...input.run,
        image: generatedImageInput(image),
        index,
        nodeId: input.context.nodeId,
        branchId: input.context.branchId,
        createdAt: input.context.message.createdAt,
        validatedImage: prepared.image,
        actor: input.actor,
        label: input.label,
        displayOrder: input.displayOrders[localIndex],
        sourcePath: capturedImageSourcePath(image),
      }).pipe(Effect.catchAll(() => Effect.void))
    }
  })
}

function captureLinks(input: {
  readonly run: SuccessfulRunResourceInput
  readonly context: MessageCaptureContext
  readonly links: readonly CapturedLink[]
  readonly actor: SessionResourceActor
  readonly activity: SessionResourceActivity
  readonly label: string | null
  readonly displayOrders: readonly (number | null)[]
  readonly state: LinkCaptureState
}) {
  return Effect.gen(function* () {
    const startIndex = input.context.linkIndex
    input.context.linkIndex += input.links.length
    for (const [localIndex, link] of input.links.entries()) {
      if (input.state.count >= SESSION_LINK_CAPTURE_LIMIT) return
      const index = startIndex + localIndex
      input.state.count += 1
      yield* captureLink({
        ...input.run,
        link,
        index,
        nodeId: input.context.nodeId,
        branchId: input.context.branchId,
        actor: input.actor,
        activity: input.activity,
        label: input.label,
        displayOrder: input.displayOrders[localIndex],
        createdAt: input.context.message.createdAt,
      }).pipe(Effect.catchAll(() => Effect.void))
    }
  })
}

function captureCompletedToolResult(input: {
  readonly run: SuccessfulRunResourceInput
  readonly context: MessageCaptureContext
  readonly planned: ReturnType<typeof assistantMessageResourcePlan>['toolResults'][number]
  readonly workingPath: string | null
  readonly state: AssistantCaptureState
}) {
  return Effect.gen(function* () {
    const groups = input.planned.groups
    if (groups.length === 0) return
    if (input.state.toolCount >= SESSION_TOOL_CAPTURE_LIMIT) {
      // Backfill enumerates every group. Reserve deferred slots before later assistant content.
      for (const group of groups) {
        const resources = group.resources
        input.context.imageIndex += resources.images.length
        input.context.linkIndex += resources.links.length
      }
      return
    }
    input.state.toolCount += 1
    yield* captureToolResultMetadata({
      sessionId: input.run.sessionId,
      toolResult: input.planned.toolResult,
      nodeId: input.context.nodeId,
      branchId: input.context.branchId,
      workingPath: input.workingPath,
      createdAt: input.context.message.createdAt,
    }).pipe(Effect.catchAll(() => Effect.void))
    for (const group of groups) {
      const { resources, positions } = group
      yield* captureImages({
        run: input.run,
        context: input.context,
        images: resources.images,
        actor: 'tool',
        label: group.label,
        displayOrders: positions.images,
        state: input.state,
      })
      yield* captureLinks({
        run: input.run,
        context: input.context,
        links: resources.links,
        actor: 'tool',
        activity: 'read',
        label: group.label,
        displayOrders: positions.links,
        state: input.state.links,
      })
    }
  })
}

function captureAssistantMessage(input: {
  readonly run: SuccessfulRunResourceInput
  readonly message: Message
  readonly workingPath: string | null
  readonly state: AssistantCaptureState
}) {
  return Effect.gen(function* () {
    const context = messageCaptureContext(input.run, input.message)
    const plan = assistantMessageResourcePlan(input.message)
    for (const planned of plan.toolResults) {
      yield* captureCompletedToolResult({
        run: input.run,
        context,
        planned,
        workingPath: input.workingPath,
        state: input.state,
      })
    }
    yield* captureImages({
      run: input.run,
      context,
      images: plan.textResources.images,
      actor: 'agent',
      label: null,
      displayOrders: plan.textPositions.images,
      state: input.state,
    })
    yield* captureLinks({
      run: input.run,
      context,
      links: plan.textResources.links,
      actor: 'agent',
      activity: 'read',
      label: null,
      displayOrders: plan.textPositions.links,
      state: input.state.links,
    })
  })
}

function captureAssistantResources(input: SuccessfulRunResourceInput, links: LinkCaptureState) {
  return Effect.gen(function* () {
    const sessions = yield* SessionRepository
    const workspace = yield* sessions
      .getWorkspace(input.sessionId)
      .pipe(Effect.catchAll(() => Effect.succeed(null)))
    const session = workspace?.tree.session ?? null
    const workingPath = resolveSessionWorkingDir(session, session?.projectPath ?? null)
    const state: AssistantCaptureState = {
      generatedImageBudget: { bytes: 0, count: 0, attempts: 0 },
      toolCount: 0,
      links,
      localImageRoots: localImageCaptureRoots(workingPath),
    }
    for (const message of input.messages) {
      if (message.role !== 'assistant') continue
      yield* captureAssistantMessage({ run: input, message, workingPath, state })
    }
  })
}

export function captureSuccessfulRunResources(input: SuccessfulRunResourceInput) {
  return withSessionResourceLock(
    input.sessionId,
    withSessionResourceInvalidation(
      input.sessionId,
      Effect.gen(function* () {
        const links: LinkCaptureState = { count: 0 }
        yield* captureUserResources(input, input.messages[0]?.createdAt ?? 0, links)
        const remainingUserMessages = input.messages
          .filter((message) => message.role === 'user')
          .slice(1)
        for (const steer of input.acceptedSteers ?? []) {
          const index = remainingUserMessages.findIndex((message) =>
            message.parts.some((part) => part.type === 'text' && part.text === steer.durableText),
          )
          if (index < 0) continue
          const [message] = remainingUserMessages.splice(index, 1)
          if (!message) continue
          yield* captureUserResources(
            { ...input, payload: steer.payload, messages: [message] },
            message.createdAt,
            links,
          )
        }
        // Session Host steering may outlive the IPC handler that accepted it. The
        // persisted user turn is still authoritative for its text and attachment
        // parts, even when the original steering payload is no longer in memory.
        for (const message of remainingUserMessages) {
          yield* captureUserResources(
            {
              ...input,
              payload: { ...input.payload, text: getMessageText(message), attachments: [] },
              messages: [message],
            },
            message.createdAt,
            links,
          )
        }
        yield* captureAssistantResources(input, links)
      }),
    ),
  )
}
