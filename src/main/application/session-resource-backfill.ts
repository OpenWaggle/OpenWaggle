import type { Message } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { SessionNode } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import { captureAttachment, captureGeneratedImage, captureLink } from './session-resource-capture'
import { collectExplicitResources } from './session-resource-extraction'
import { withSessionResourceLock } from './session-resource-lock'

/** Rebuilds explicit resources with deterministic, idempotent occurrence ids. */
export function captureProjectedSessionResources(input: {
  readonly sessionId: SessionId
  readonly messages?: readonly Message[]
  readonly nodes?: readonly SessionNode[]
}) {
  return withSessionResourceLock(
    input.sessionId,
    Effect.gen(function* () {
      const projected = input.nodes
        ? input.nodes.flatMap((node) =>
            node.message
              ? [
                  {
                    message: node.message,
                    nodeId: String(node.id),
                    branchId: node.branchId ?? null,
                  },
                ]
              : [],
          )
        : (input.messages ?? []).map((message) => ({
            message,
            nodeId: String(message.id),
            branchId: null,
          }))
      for (const { message, nodeId, branchId } of projected) {
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
              branchId,
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
              branchId,
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
            branchId,
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
            branchId,
          }).pipe(Effect.catchAll(() => Effect.void))
        }
      }
    }),
  )
}
