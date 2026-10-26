import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import type { MessagePart } from '@shared/types/agent'
import { createModelRef } from '@shared/types/llm'
import { toJsonValue } from '../pi-message-mapper'
import type { PiEntryProjection } from './entry-projections'
import {
  buildMessageNodeContentJson,
  buildRawNodeContentJson,
  piAssistantContentToParts,
} from './message-parts'

type PiAssistantMessage = Extract<
  Extract<SessionEntry, { type: 'message' }>['message'],
  { role: 'assistant' }
>

function isBlankPart(part: MessagePart) {
  return (part.type === 'text' || part.type === 'reasoning') && part.text.trim() === ''
}

export function assistantMessageProjection(value: PiAssistantMessage): PiEntryProjection {
  const parts = piAssistantContentToParts(value.content)
  // Pi records the response a Stop or interrupt cut off. One that had streamed nothing is not a
  // message: keep its node for the Pi tree, but as raw data the transcript does not show.
  if (value.stopReason === 'aborted' && parts.every(isBlankPart)) {
    return {
      kind: 'custom',
      role: null,
      contentJson: buildRawNodeContentJson({
        role: 'assistant',
        stopReason: value.stopReason,
        api: value.api,
        provider: value.provider,
        model: value.model,
      }),
      metadataJson: '{}',
    }
  }
  return {
    kind: 'assistant_message',
    role: 'assistant',
    contentJson: buildMessageNodeContentJson(parts, createModelRef(value.provider, value.model)),
    metadataJson: buildRawNodeContentJson({
      api: value.api,
      provider: value.provider,
      model: value.model,
      usage: toJsonValue(value.usage),
      stopReason: value.stopReason,
      errorMessage: value.errorMessage ?? null,
    }),
  }
}
