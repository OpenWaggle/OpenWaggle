import type { AgentSendPayload, Message } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { SessionResourceActivity, SessionResourceActor } from '@shared/types/session-resource'
import type { ToolCallResult } from '@shared/types/tools'
import { resolveSessionWorkingDir } from '@shared/utils/worktree'
import * as Effect from 'effect/Effect'
import { SessionRepository } from '../ports/session-repository'
import { captureGeneratedImage } from './session-resource-capture-image'
import {
  type GeneratedImageCaptureBudget,
  prepareGeneratedImageForCapture,
} from './session-resource-capture-image-budget'
import { captureLink } from './session-resource-capture-link'
import {
  captureToolResultMetadata,
  SESSION_TOOL_CAPTURE_LIMIT,
  toolResultOutputGroups,
} from './session-resource-capture-tool'
import {
  captureUserResources,
  type LinkCaptureState,
  SESSION_LINK_CAPTURE_LIMIT,
} from './session-resource-capture-user'
import {
  type CapturedImage,
  type CapturedLink,
  collectExplicitResources,
} from './session-resource-extraction'
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
}

interface AssistantCaptureState {
  generatedImageBudget: GeneratedImageCaptureBudget
  toolCount: number
  readonly links: LinkCaptureState
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
  readonly state: AssistantCaptureState
}) {
  return Effect.gen(function* () {
    for (const image of input.images) {
      const index = input.context.imageIndex
      input.context.imageIndex += 1
      const prepared = prepareGeneratedImageForCapture(input.state.generatedImageBudget, image)
      if (!prepared) return
      input.state.generatedImageBudget = prepared.budget
      if (!prepared.image) continue
      yield* captureGeneratedImage({
        ...input.run,
        image,
        index,
        nodeId: input.context.nodeId,
        branchId: input.context.branchId,
        createdAt: input.context.message.createdAt,
        validatedImage: prepared.image,
        actor: input.actor,
        label: input.label,
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
  readonly state: LinkCaptureState
}) {
  return Effect.gen(function* () {
    for (const link of input.links) {
      if (input.state.count >= SESSION_LINK_CAPTURE_LIMIT) return
      const index = input.context.linkIndex
      input.context.linkIndex += 1
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
        createdAt: input.context.message.createdAt,
      }).pipe(Effect.catchAll(() => Effect.void))
    }
  })
}

function captureCompletedToolResult(input: {
  readonly run: SuccessfulRunResourceInput
  readonly context: MessageCaptureContext
  readonly toolResult: ToolCallResult
  readonly workingPath: string | null
  readonly state: AssistantCaptureState
}) {
  return Effect.gen(function* () {
    const groups = toolResultOutputGroups(input.toolResult)
    if (groups.length === 0 || input.state.toolCount >= SESSION_TOOL_CAPTURE_LIMIT) return
    input.state.toolCount += 1
    yield* captureToolResultMetadata({
      sessionId: input.run.sessionId,
      toolResult: input.toolResult,
      nodeId: input.context.nodeId,
      branchId: input.context.branchId,
      workingPath: input.workingPath,
      createdAt: input.context.message.createdAt,
    }).pipe(Effect.catchAll(() => Effect.void))
    for (const group of groups) {
      const resources = collectExplicitResources(group.result)
      yield* captureImages({
        run: input.run,
        context: input.context,
        images: resources.images,
        actor: 'tool',
        label: group.label,
        state: input.state,
      })
      yield* captureLinks({
        run: input.run,
        context: input.context,
        links: resources.links,
        actor: 'tool',
        activity: 'read',
        label: group.label,
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
    for (const part of input.message.parts) {
      if (part.type !== 'tool-result') continue
      yield* captureCompletedToolResult({
        run: input.run,
        context,
        toolResult: part.toolResult,
        workingPath: input.workingPath,
        state: input.state,
      })
    }
    const textParts = input.message.parts.filter((part) => part.type === 'text')
    const resources = collectExplicitResources(textParts)
    yield* captureImages({
      run: input.run,
      context,
      images: resources.images,
      actor: 'agent',
      label: null,
      state: input.state,
    })
    yield* captureLinks({
      run: input.run,
      context,
      links: resources.links,
      actor: 'agent',
      activity: 'read',
      label: null,
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
        yield* captureAssistantResources(input, links)
      }),
    ),
  )
}
