import type { MessagePart } from '@shared/types/agent'
import type { BackgroundRunActivityEvent } from '@shared/types/background-run'
import type { JsonValue } from '@shared/types/json'
import { retainedBytesAfterTextAppend, retainedPartsBytes } from './stream-buffer-byte-accounting'
import {
  appendReasoningPart,
  appendTextPart,
  upsertToolCallPart,
} from './stream-buffer-message-parts'
import {
  type ActiveStreamBuffer,
  exceedsStreamBufferLimit,
  MAX_ACTIVE_STREAM_BUFFER_BYTES,
  MAX_TOTAL_STREAM_BUFFER_BYTES,
  retainDegradedToolCallId,
  retainedStreamBufferBytes,
} from './stream-buffer-snapshots'

export interface StreamBufferUpdate {
  readonly buffer: ActiveStreamBuffer
  readonly retainedDelta: number
}

export function updateStreamBufferParts(
  buffer: ActiveStreamBuffer,
  update: (parts: readonly MessagePart[]) => readonly MessagePart[],
  totalRetainedBytes: number,
  attemptedContentBytes?: number,
): StreamBufferUpdate {
  const parts = update(buffer.parts)
  const retainedBytes = retainedPartsBytes(parts)
  const retainedDelta = retainedBytes - buffer.retainedBytes
  if (exceedsStreamBufferLimit(buffer, retainedBytes, totalRetainedBytes, retainedDelta)) {
    return {
      buffer: {
        ...buffer,
        omittedBytes: buffer.omittedBytes + (attemptedContentBytes ?? Math.max(0, retainedDelta)),
      },
      retainedDelta: 0,
    }
  }
  return { buffer: { ...buffer, parts, retainedBytes }, retainedDelta }
}

export function appendStreamBufferToolCallDelta(
  buffer: ActiveStreamBuffer,
  input: { readonly toolCallId: string; readonly delta: string; readonly args: JsonValue },
  totalRetainedBytes: number,
): StreamBufferUpdate {
  const deltaBytes = Buffer.byteLength(input.delta, 'utf8')
  if (buffer.degradedToolCallIds.has(input.toolCallId)) {
    return {
      buffer: { ...buffer, omittedBytes: buffer.omittedBytes + deltaBytes },
      retainedDelta: 0,
    }
  }
  const parts = upsertToolCallPart({
    parts: buffer.parts,
    toolCallId: input.toolCallId,
    args: input.args,
  })
  const hasExistingPart = buffer.parts.some(
    (part) => part.type === 'tool-call' && String(part.toolCall.id) === input.toolCallId,
  )
  const retainedBytes = hasExistingPart
    ? buffer.retainedBytes + deltaBytes
    : retainedPartsBytes(parts)
  const retainedDelta = retainedBytes - buffer.retainedBytes
  if (exceedsStreamBufferLimit(buffer, retainedBytes, totalRetainedBytes, retainedDelta)) {
    const degraded = retainDegradedToolCallId(buffer, input.toolCallId, totalRetainedBytes)
    return {
      buffer: { ...degraded.buffer, omittedBytes: buffer.omittedBytes + deltaBytes },
      retainedDelta: degraded.retainedDelta,
    }
  }
  return { buffer: { ...buffer, parts, retainedBytes }, retainedDelta }
}

export function appendStreamBufferText(
  buffer: ActiveStreamBuffer,
  type: 'text' | 'reasoning',
  delta: string,
  totalRetainedBytes: number,
): StreamBufferUpdate {
  const parts =
    type === 'text' ? appendTextPart(buffer.parts, delta) : appendReasoningPart(buffer.parts, delta)
  const retainedBytes = retainedBytesAfterTextAppend({
    parts: buffer.parts,
    retainedBytes: buffer.retainedBytes,
    type,
    delta,
  })
  const retainedDelta = retainedBytes - buffer.retainedBytes
  if (exceedsStreamBufferLimit(buffer, retainedBytes, totalRetainedBytes, retainedDelta)) {
    return {
      buffer: {
        ...buffer,
        omittedBytes: buffer.omittedBytes + Buffer.byteLength(delta, 'utf8'),
      },
      retainedDelta: 0,
    }
  }
  return { buffer: { ...buffer, parts, retainedBytes }, retainedDelta }
}

export function updateStreamBufferActivityEvents(
  buffer: ActiveStreamBuffer,
  update: (events: readonly BackgroundRunActivityEvent[]) => readonly BackgroundRunActivityEvent[],
  totalRetainedBytes: number,
): StreamBufferUpdate {
  const activityEvents = update(buffer.activityEvents ?? [])
  const activityEventsBytes =
    activityEvents.length > 0 ? Buffer.byteLength(JSON.stringify(activityEvents), 'utf8') : 0
  const retainedDelta = activityEventsBytes - (buffer.activityEventsBytes ?? 0)
  if (
    retainedStreamBufferBytes(buffer) + retainedDelta > MAX_ACTIVE_STREAM_BUFFER_BYTES ||
    totalRetainedBytes + retainedDelta > MAX_TOTAL_STREAM_BUFFER_BYTES
  ) {
    return { buffer, retainedDelta: 0 }
  }
  return { buffer: { ...buffer, activityEvents, activityEventsBytes }, retainedDelta }
}
