import type { AgentSendPayload, Message } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import {
  imageBase64DecodedByteLength,
  MAX_CAPTURED_IMAGE_BYTES,
  type ValidatedSessionResourceImage,
  validatedImageBytes,
} from '../domain/session-resource-image'
import { captureAttachment } from './session-resource-capture-attachment'
import { captureGeneratedImage } from './session-resource-capture-image'
import { captureLink } from './session-resource-capture-link'
import { collectExplicitResources } from './session-resource-extraction'
import { withSessionResourceLock } from './session-resource-lock'

export const SESSION_LINK_CAPTURE_LIMIT = 32
export const GENERATED_IMAGE_CAPTURE_LIMITS = {
  maxBytes: 100 * 1024 * 1024,
  maxCount: 32,
} as const

export interface GeneratedImageCaptureBudget {
  readonly bytes: number
  readonly count: number
}

interface GeneratedImageInput {
  readonly data: string
  readonly mimeType: string
}

type GeneratedImageValidator = (
  data: string,
  mimeType: string,
) => ValidatedSessionResourceImage | null

export function advanceGeneratedImageCaptureBudget(
  current: GeneratedImageCaptureBudget,
  byteLength: number,
): GeneratedImageCaptureBudget | null {
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength <= 0 ||
    byteLength > MAX_CAPTURED_IMAGE_BYTES ||
    current.count >= GENERATED_IMAGE_CAPTURE_LIMITS.maxCount ||
    current.bytes > GENERATED_IMAGE_CAPTURE_LIMITS.maxBytes - byteLength
  ) {
    return null
  }
  return { bytes: current.bytes + byteLength, count: current.count + 1 }
}

/**
 * Avoids allocating a decoded buffer when the run budget cannot accept the image.
 * The returned budget is charged only after its signature has been validated.
 */
export function prepareGeneratedImageForCapture(
  current: GeneratedImageCaptureBudget,
  image: GeneratedImageInput,
  validate: GeneratedImageValidator = validatedImageBytes,
): {
  readonly budget: GeneratedImageCaptureBudget
  readonly image: ValidatedSessionResourceImage
} | null {
  if (
    current.count >= GENERATED_IMAGE_CAPTURE_LIMITS.maxCount ||
    current.bytes >= GENERATED_IMAGE_CAPTURE_LIMITS.maxBytes
  ) {
    return null
  }
  const decodedByteLength = imageBase64DecodedByteLength(image.data, image.mimeType)
  if (
    decodedByteLength === null ||
    advanceGeneratedImageCaptureBudget(current, decodedByteLength) === null
  ) {
    return null
  }
  const validatedImage = validate(image.data, image.mimeType)
  if (!validatedImage) return null
  const budget = advanceGeneratedImageCaptureBudget(current, validatedImage.bytes.byteLength)
  return budget ? { budget, image: validatedImage } : null
}

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

interface LinkCaptureState {
  count: number
}

function captureUserResources(
  input: SuccessfulRunResourceInput,
  createdAt: number,
  linkState: LinkCaptureState,
) {
  return Effect.gen(function* () {
    const userMessage = input.messages.find((message) => message.role === 'user')
    const userMessageId = userMessage ? String(userMessage.id) : null
    const nodeId = userMessageId
      ? (input.nodeIdByMessageId?.[userMessageId] ?? userMessageId)
      : null
    const branchId = userMessageId ? (input.branchIdByMessageId?.[userMessageId] ?? null) : null
    const persistedAttachments = userMessage?.parts.flatMap((part) =>
      part.type === 'attachment' ? [part.attachment] : [],
    )
    const attachments = persistedAttachments?.length
      ? persistedAttachments
      : input.payload.attachments
    for (const [index, attachment] of attachments.entries()) {
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
      if (linkState.count >= SESSION_LINK_CAPTURE_LIMIT) break
      linkState.count += 1
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

function captureAssistantResources(
  input: SuccessfulRunResourceInput,
  createdAt: number,
  linkState: LinkCaptureState,
) {
  return Effect.gen(function* () {
    let generatedImageBudget: GeneratedImageCaptureBudget = { bytes: 0, count: 0 }
    for (const message of input.messages) {
      if (message.role !== 'assistant') continue
      const messageId = String(message.id)
      const nodeId = input.nodeIdByMessageId?.[messageId] ?? messageId
      const branchId = input.branchIdByMessageId?.[messageId] ?? null
      const captured = collectExplicitResources(message.parts)
      for (const [index, image] of captured.images.entries()) {
        const prepared = prepareGeneratedImageForCapture(generatedImageBudget, image)
        if (!prepared) continue
        generatedImageBudget = prepared.budget
        yield* captureGeneratedImage({
          ...input,
          image,
          index,
          nodeId,
          branchId,
          createdAt,
          validatedImage: prepared.image,
        }).pipe(Effect.catchAll(() => Effect.void))
      }
      for (const [index, link] of captured.links.entries()) {
        if (linkState.count >= SESSION_LINK_CAPTURE_LIMIT) break
        linkState.count += 1
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
      const linkState: LinkCaptureState = { count: 0 }
      yield* captureUserResources(input, createdAt, linkState)
      yield* captureAssistantResources(input, createdAt, linkState)
    }),
  )
}
