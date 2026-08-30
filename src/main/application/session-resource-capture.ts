import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import type { AgentSendPayload, Message } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { SessionResourceActivity, SessionResourceActor } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import { SessionResourceRepository } from '../ports/session-resource-repository'
import { SessionResourceStore } from '../ports/session-resource-store'
import {
  type CapturedImage,
  type CapturedLink,
  collectExplicitResources,
} from './session-resource-extraction'

const MAX_CAPTURED_IMAGE_BYTES = 25 * 1024 * 1024

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

function extensionForMimeType(mimeType: string) {
  if (mimeType === 'image/jpeg') return '.jpg'
  if (mimeType === 'image/webp') return '.webp'
  if (mimeType === 'image/gif') return '.gif'
  if (mimeType === 'image/svg+xml') return '.svg'
  return '.png'
}

function imageFileName(title: string, mimeType: string) {
  return path.extname(title) ? title : `${title}${extensionForMimeType(mimeType)}`
}

function safeBase64Bytes(data: string) {
  const bytes = Buffer.from(data, 'base64')
  return bytes.byteLength > 0 && bytes.byteLength <= MAX_CAPTURED_IMAGE_BYTES ? bytes : null
}

function occurrence(input: {
  readonly id: string
  readonly nodeId: string | null
  readonly actor: SessionResourceActor
  readonly activity: SessionResourceActivity
  readonly createdAt: number
}) {
  return {
    id: input.id,
    nodeId: input.nodeId,
    branchId: null,
    actor: input.actor,
    activity: input.activity,
    label: null,
    createdAt: input.createdAt,
  }
}

export function captureAttachment(input: {
  readonly sessionId: SessionId
  readonly runId: string
  readonly attachment: AgentSendPayload['attachments'][number]
  readonly index: number
  readonly nodeId: string | null
  readonly createdAt: number
}) {
  return Effect.gen(function* () {
    const repository = yield* SessionResourceRepository
    const store = yield* SessionResourceStore
    const resourceId = randomUUID()
    const stored = yield* store.storeFile({
      sessionId: input.sessionId,
      resourceId,
      fileName: input.attachment.name,
      sourcePath: input.attachment.path,
    })
    const locator = `session-resource://${resourceId}`
    const resource = yield* repository.upsert({
      id: resourceId,
      sessionId: input.sessionId,
      canonicalKey: `sha256:${stored.sha256}`,
      kind: input.attachment.kind === 'image' ? 'image' : 'file',
      title: input.attachment.name,
      mimeType: input.attachment.mimeType,
      locator,
      managedPath: stored.path,
      available: true,
      occurrence: occurrence({
        id: `provided:${input.runId}:${input.attachment.id}:${String(input.index)}`,
        nodeId: input.nodeId,
        actor: 'user',
        activity: 'provided',
        createdAt: input.createdAt,
      }),
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    })
    if (resource.locator !== locator) {
      yield* store.remove(stored.path)
    }
  })
}

export function captureGeneratedImage(input: {
  readonly sessionId: SessionId
  readonly runId: string
  readonly image: CapturedImage
  readonly index: number
  readonly nodeId: string
  readonly createdAt: number
}) {
  return Effect.gen(function* () {
    const bytes = safeBase64Bytes(input.image.data)
    if (!bytes) return
    const repository = yield* SessionResourceRepository
    const store = yield* SessionResourceStore
    const digestHex = sha256(bytes)
    const canonicalKey = `sha256:${digestHex}`
    const fileName = imageFileName(input.image.title, input.image.mimeType)
    const existing = yield* repository.findByCanonicalKey(input.sessionId, canonicalKey)
    if (existing) {
      yield* repository.upsert({
        id: existing.id,
        sessionId: input.sessionId,
        canonicalKey,
        kind: 'image',
        title: existing.title,
        mimeType: existing.mimeType ?? input.image.mimeType,
        locator: existing.locator,
        managedPath: null,
        available: existing.available,
        occurrence: occurrence({
          id: `created:${input.runId}:image:${String(input.index)}:${digestHex}`,
          nodeId: input.nodeId,
          actor: 'agent',
          activity: 'created',
          createdAt: input.createdAt,
        }),
        createdAt: existing.createdAt,
        updatedAt: input.createdAt,
      })
      return
    }
    const resourceId = randomUUID()
    const stored = yield* store.storeBytes({
      sessionId: input.sessionId,
      resourceId,
      fileName,
      bytes,
    })
    const locator = `session-resource://${resourceId}`
    const resource = yield* repository.upsert({
      id: resourceId,
      sessionId: input.sessionId,
      canonicalKey,
      kind: 'image',
      title: fileName,
      mimeType: input.image.mimeType,
      locator,
      managedPath: stored.path,
      available: true,
      occurrence: occurrence({
        id: `created:${input.runId}:image:${String(input.index)}:${stored.sha256}`,
        nodeId: input.nodeId,
        actor: 'agent',
        activity: 'created',
        createdAt: input.createdAt,
      }),
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    })
    if (resource.locator !== locator) {
      yield* store.remove(stored.path)
    }
  })
}

export function captureLink(input: {
  readonly sessionId: SessionId
  readonly runId: string
  readonly link: CapturedLink
  readonly index: number
  readonly nodeId: string | null
  readonly actor: SessionResourceActor
  readonly activity: SessionResourceActivity
  readonly createdAt: number
}) {
  return Effect.gen(function* () {
    const repository = yield* SessionResourceRepository
    const resourceId = randomUUID()
    yield* repository.upsert({
      id: resourceId,
      sessionId: input.sessionId,
      canonicalKey: `url:${input.link.url}`,
      kind: input.link.image ? 'image' : 'link',
      title: input.link.title,
      mimeType: null,
      locator: input.link.url,
      managedPath: null,
      available: true,
      occurrence: occurrence({
        id: `${input.activity}:${input.runId}:link:${String(input.index)}:${sha256(Buffer.from(input.link.url))}`,
        nodeId: input.nodeId,
        actor: input.actor,
        activity: input.activity,
        createdAt: input.createdAt,
      }),
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    })
  })
}

export function captureSuccessfulRunResources(input: {
  readonly sessionId: SessionId
  readonly runId: string
  readonly payload: AgentSendPayload
  readonly messages: readonly Message[]
}) {
  return Effect.gen(function* () {
    const createdAt = Date.now()
    const userMessage = input.messages.find((message) => message.role === 'user')
    const userNodeId = userMessage ? String(userMessage.id) : null
    for (const [index, attachment] of input.payload.attachments.entries()) {
      yield* captureAttachment({ ...input, attachment, index, nodeId: userNodeId, createdAt }).pipe(
        Effect.catchAll(() => Effect.void),
      )
    }

    const userLinks = collectExplicitResources(input.payload.text).links
    for (const [index, link] of userLinks.entries()) {
      yield* captureLink({
        ...input,
        link,
        index,
        nodeId: userNodeId,
        actor: 'user',
        activity: 'provided',
        createdAt,
      }).pipe(Effect.catchAll(() => Effect.void))
    }

    for (const message of input.messages) {
      if (message.role !== 'assistant') continue
      const captured = collectExplicitResources(message.parts)
      for (const [index, image] of captured.images.entries()) {
        yield* captureGeneratedImage({
          ...input,
          image,
          index,
          nodeId: String(message.id),
          createdAt,
        }).pipe(Effect.catchAll(() => Effect.void))
      }
      for (const [index, link] of captured.links.entries()) {
        yield* captureLink({
          ...input,
          link,
          index,
          nodeId: String(message.id),
          actor: 'agent',
          activity: 'read',
          createdAt,
        }).pipe(Effect.catchAll(() => Effect.void))
      }
    }
  })
}
