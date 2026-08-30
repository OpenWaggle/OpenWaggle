import type { Message } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { captureAttachment, captureGeneratedImage, captureLink } from './session-resource-capture'
import { collectExplicitResources } from './session-resource-extraction'

/** Rebuilds explicit resources with deterministic, idempotent occurrence ids. */
export function captureProjectedSessionResources(input: {
  readonly sessionId: SessionId
  readonly messages: readonly Message[]
}) {
  return Effect.gen(function* () {
    for (const message of input.messages) {
      const nodeId = String(message.id)
      const runId = `backfill:${nodeId}`
      if (message.role === 'user') {
        const attachments = message.parts.filter((part) => part.type === 'attachment')
        for (const [index, part] of attachments.entries()) {
          yield* captureAttachment({
            sessionId: input.sessionId,
            runId,
            attachment: part.attachment,
            index,
            nodeId,
            createdAt: message.createdAt,
          }).pipe(Effect.catchAll(() => Effect.void))
        }
        const links = collectExplicitResources(message.parts).links
        for (const [index, link] of links.entries()) {
          yield* captureLink({
            sessionId: input.sessionId,
            runId,
            link,
            index,
            nodeId,
            actor: 'user',
            activity: 'provided',
            createdAt: message.createdAt,
          }).pipe(Effect.catchAll(() => Effect.void))
        }
        continue
      }
      if (message.role !== 'assistant') continue
      const captured = collectExplicitResources(message.parts)
      for (const [index, image] of captured.images.entries()) {
        yield* captureGeneratedImage({
          sessionId: input.sessionId,
          runId,
          image,
          index,
          nodeId,
          createdAt: message.createdAt,
        }).pipe(Effect.catchAll(() => Effect.void))
      }
      for (const [index, link] of captured.links.entries()) {
        yield* captureLink({
          sessionId: input.sessionId,
          runId,
          link,
          index,
          nodeId,
          actor: 'agent',
          activity: 'read',
          createdAt: message.createdAt,
        }).pipe(Effect.catchAll(() => Effect.void))
      }
    }
  })
}
