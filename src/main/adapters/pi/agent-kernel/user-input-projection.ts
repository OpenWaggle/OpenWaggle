import { createHash } from 'node:crypto'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { Schema, safeDecodeUnknown } from '@shared/schema'
import { preparedAttachmentSchema } from '@shared/schemas/validation'
import type { MessagePart } from '@shared/types/agent'
import {
  buildPersistedUserMessageParts,
  type PersistedUserMessagePartsPayload,
} from '../../../agent/shared'
import { stripAtomicVisualizationContext } from '../pi-runtime-input'

export const OPENWAGGLE_USER_INPUT_CUSTOM_TYPE = 'openwaggle-user-input'

const userInputProjectionSchema = Schema.Struct({
  version: Schema.Literal(1),
  parts: Schema.Array(
    Schema.Union(
      Schema.Struct({ type: Schema.Literal('text'), text: Schema.String }),
      Schema.Struct({ type: Schema.Literal('attachment'), attachment: preparedAttachmentSchema }),
    ),
  ),
  durableTextSha256: Schema.optional(Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/))),
})

type ProjectionSession = {
  readonly sessionManager: Pick<AgentSession['sessionManager'], 'appendCustomEntry'>
  readonly subscribe: AgentSession['subscribe']
}
type SessionEvent = Parameters<Parameters<AgentSession['subscribe']>[0]>[0]
type PendingProjection = {
  readonly payload: PersistedUserMessagePartsPayload
  readonly signal?: AbortSignal
  cancel: () => void
}
type ProjectionQueue = {
  readonly pending: PendingProjection[]
  stop: () => void
}

const projectionQueues = new WeakMap<object, ProjectionQueue>()

export function buildUserInputProjection(
  payload: PersistedUserMessagePartsPayload,
  durableText?: string,
) {
  return {
    version: 1 as const,
    parts: buildPersistedUserMessageParts(payload),
    ...(durableText === undefined
      ? {}
      : {
          durableTextSha256: createHash('sha256')
            .update(stripAtomicVisualizationContext(durableText), 'utf8')
            .digest('hex'),
        }),
  }
}

function userMessageText(event: SessionEvent) {
  if (event.type !== 'message_start' || event.message.role !== 'user') return null
  const { content } = event.message
  return typeof content === 'string'
    ? content
    : (content.find((part) => part.type === 'text')?.text ?? '')
}

function closeEmptyQueue(session: ProjectionSession, queue: ProjectionQueue) {
  if (queue.pending.length > 0) return
  queue.stop()
  projectionQueues.delete(session)
}

function projectionQueue(session: ProjectionSession) {
  const existing = projectionQueues.get(session)
  if (existing) return existing

  const queue: ProjectionQueue = { pending: [], stop: () => undefined }
  projectionQueues.set(session, queue)
  queue.stop = session.subscribe((event) => {
    const durableText = userMessageText(event)
    if (durableText === null) return
    const pending = queue.pending.shift()
    if (!pending) return
    pending.signal?.removeEventListener('abort', pending.cancel)
    session.sessionManager.appendCustomEntry(
      OPENWAGGLE_USER_INPUT_CUSTOM_TYPE,
      buildUserInputProjection(pending.payload, durableText),
    )
    closeEmptyQueue(session, queue)
  })
  return queue
}

/** Appends display-only input immediately before Pi persists the corresponding user message. */
export function enqueueUserInputProjection(
  session: ProjectionSession,
  payload: PersistedUserMessagePartsPayload,
  signal?: AbortSignal,
) {
  const queue = projectionQueue(session)
  const pending: PendingProjection = {
    payload,
    signal,
    cancel: () => {
      const index = queue.pending.indexOf(pending)
      if (index < 0) return
      queue.pending.splice(index, 1)
      signal?.removeEventListener('abort', pending.cancel)
      closeEmptyQueue(session, queue)
    },
  }
  queue.pending.push(pending)
  signal?.addEventListener('abort', pending.cancel, { once: true })
  if (signal?.aborted) pending.cancel()
  return pending.cancel
}

function decodeProjection(value: unknown) {
  const decoded = safeDecodeUnknown(userInputProjectionSchema, value)
  return decoded.success ? decoded.data : null
}

export function decodeUserInputProjection(value: unknown): readonly MessagePart[] | null {
  return decodeProjection(value)?.parts ?? null
}

export function decodeUserInputProjectionDigest(value: unknown) {
  return decodeProjection(value)?.durableTextSha256 ?? null
}
