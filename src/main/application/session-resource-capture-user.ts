import type { AgentSendPayload, Message } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { captureAttachment } from './session-resource-capture-attachment'
import { captureLink } from './session-resource-capture-link'
import { collectExplicitResources } from './session-resource-extraction'

export const SESSION_LINK_CAPTURE_LIMIT = 32

export interface LinkCaptureState {
  count: number
}

interface UserRunResourceInput {
  readonly sessionId: SessionId
  readonly runId: string
  readonly payload: AgentSendPayload
  readonly messages: readonly Message[]
  readonly nodeIdByMessageId?: Readonly<Record<string, string>>
  readonly branchIdByMessageId?: Readonly<Record<string, string | null>>
}

interface UserCaptureContext {
  readonly message: Message | null
  readonly nodeId: string | null
  readonly branchId: string | null
  readonly createdAt: number
}

function userCaptureContext(
  input: UserRunResourceInput,
  fallbackCreatedAt: number,
): UserCaptureContext {
  const message = input.messages.find((candidate) => candidate.role === 'user') ?? null
  const messageId = message ? String(message.id) : null
  return {
    message,
    nodeId: messageId ? (input.nodeIdByMessageId?.[messageId] ?? messageId) : null,
    branchId: messageId ? (input.branchIdByMessageId?.[messageId] ?? null) : null,
    createdAt: message?.createdAt ?? fallbackCreatedAt,
  }
}

function captureUserAttachments(input: UserRunResourceInput, context: UserCaptureContext) {
  return Effect.gen(function* () {
    const persisted = context.message?.parts.flatMap((part) =>
      part.type === 'attachment' ? [part.attachment] : [],
    )
    const attachments = persisted?.length ? persisted : input.payload.attachments
    for (const [index, attachment] of attachments.entries()) {
      yield* captureAttachment({
        ...input,
        attachment,
        index,
        nodeId: context.nodeId,
        branchId: context.branchId,
        createdAt: context.createdAt,
      }).pipe(Effect.catchAll(() => Effect.void))
    }
  })
}

function captureUserLinks(
  input: UserRunResourceInput,
  context: UserCaptureContext,
  state: LinkCaptureState,
) {
  return Effect.gen(function* () {
    for (const [index, link] of collectExplicitResources(input.payload.text).links.entries()) {
      if (state.count >= SESSION_LINK_CAPTURE_LIMIT) return
      state.count += 1
      yield* captureLink({
        ...input,
        link,
        index,
        nodeId: context.nodeId,
        branchId: context.branchId,
        actor: 'user',
        activity: 'provided',
        label: null,
        createdAt: context.createdAt,
      }).pipe(Effect.catchAll(() => Effect.void))
    }
  })
}

export function captureUserResources(
  input: UserRunResourceInput,
  fallbackCreatedAt: number,
  linkState: LinkCaptureState,
) {
  const context = userCaptureContext(input, fallbackCreatedAt)
  return captureUserAttachments(input, context).pipe(
    Effect.andThen(captureUserLinks(input, context, linkState)),
  )
}
