import { type AgentSendPayload, getMessageText, type Message } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { captureAttachment } from './session-resource-capture-attachment'
import { captureLink } from './session-resource-capture-link'
import { collectExplicitResources } from './session-resource-extraction'

export const SESSION_LINK_CAPTURE_LIMIT = 32

export interface AcceptedAgentSteer {
  readonly payload: AgentSendPayload
  readonly durableText: string
}

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
    const persistedAttachmentCount = context.message?.parts.filter(
      (part) => part.type === 'attachment',
    ).length
    const attachmentCount = persistedAttachmentCount || input.payload.attachments.length
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
        displayOrder: link.image ? attachmentCount + index : null,
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

/**
 * The Run's user turns: the message that started it, then each steer, matched to the payload it
 * was accepted with. `slice` returns to the event loop between turns (#357).
 */
export function captureRunUserResources(
  input: UserRunResourceInput & { readonly acceptedSteers?: readonly AcceptedAgentSteer[] },
  links: LinkCaptureState,
  slice: Effect.Effect<void>,
) {
  return Effect.gen(function* () {
    yield* captureUserResources(input, input.messages[0]?.createdAt ?? 0, links)
    yield* slice
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
      yield* slice
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
      yield* slice
    }
  })
}
