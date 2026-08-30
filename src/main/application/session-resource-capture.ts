import type { AgentSendPayload, Message } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { captureAttachment } from './session-resource-capture-attachment'
import { captureGeneratedImage } from './session-resource-capture-image'
import { captureLink } from './session-resource-capture-link'
import { collectExplicitResources } from './session-resource-extraction'
import { withSessionResourceLock } from './session-resource-lock'

const MAX_AGENT_REMOTE_IMAGES_PER_RUN = 32

export { captureAttachment } from './session-resource-capture-attachment'
export { captureGeneratedImage } from './session-resource-capture-image'
export { captureLink } from './session-resource-capture-link'

interface SuccessfulRunResourceInput {
  readonly sessionId: SessionId
  readonly runId: string
  readonly payload: AgentSendPayload
  readonly messages: readonly Message[]
  readonly nodeIdByMessageId?: Readonly<Record<string, string>>
  readonly branchIdByMessageId?: Readonly<Record<string, string | null>>
}

function captureUserResources(input: SuccessfulRunResourceInput, createdAt: number) {
  return Effect.gen(function* () {
    const userMessage = input.messages.find((message) => message.role === 'user')
    const userMessageId = userMessage ? String(userMessage.id) : null
    const nodeId = userMessageId
      ? (input.nodeIdByMessageId?.[userMessageId] ?? userMessageId)
      : null
    const branchId = userMessageId ? (input.branchIdByMessageId?.[userMessageId] ?? null) : null
    for (const [index, attachment] of input.payload.attachments.entries()) {
      yield* captureAttachment({
        ...input,
        attachment,
        index,
        nodeId,
        branchId,
        createdAt,
      }).pipe(Effect.catchAll(() => Effect.void))
    }
    for (const [index, link] of collectExplicitResources(input.payload.text).links.entries()) {
      yield* captureLink({
        ...input,
        link,
        index,
        nodeId,
        branchId,
        actor: 'user',
        activity: 'provided',
        createdAt,
      }).pipe(Effect.catchAll(() => Effect.void))
    }
  })
}

function captureAssistantResources(input: SuccessfulRunResourceInput, createdAt: number) {
  return Effect.gen(function* () {
    let remoteImageCount = 0
    for (const message of input.messages) {
      if (message.role !== 'assistant') continue
      const messageId = String(message.id)
      const nodeId = input.nodeIdByMessageId?.[messageId] ?? messageId
      const branchId = input.branchIdByMessageId?.[messageId] ?? null
      const captured = collectExplicitResources(message.parts)
      for (const [index, image] of captured.images.entries()) {
        yield* captureGeneratedImage({
          ...input,
          image,
          index,
          nodeId,
          branchId,
          createdAt,
        }).pipe(Effect.catchAll(() => Effect.void))
      }
      for (const [index, link] of captured.links.entries()) {
        if (link.image) {
          if (remoteImageCount >= MAX_AGENT_REMOTE_IMAGES_PER_RUN) continue
          remoteImageCount += 1
        }
        yield* captureLink({
          ...input,
          link,
          index,
          nodeId,
          branchId,
          actor: 'agent',
          activity: 'read',
          createdAt,
        }).pipe(Effect.catchAll(() => Effect.void))
      }
    }
  })
}

export function captureSuccessfulRunResources(input: SuccessfulRunResourceInput) {
  return withSessionResourceLock(
    input.sessionId,
    Effect.gen(function* () {
      const createdAt = Date.now()
      yield* captureUserResources(input, createdAt)
      yield* captureAssistantResources(input, createdAt)
    }),
  )
}
