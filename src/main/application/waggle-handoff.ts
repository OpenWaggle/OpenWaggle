import { safeDecodeUnknown } from '@shared/schema'
import { toWaggleHandoffRequest, waggleHandoffRequestSchema } from '@shared/schemas/waggle'
import type { Message } from '@shared/types/agent'
import type { WaggleHandoffRequest } from '@shared/types/waggle'

const WAGGLE_INVOKE_TOOL_NAME = 'waggle_invoke'

export function findWaggleHandoffRequest(
  messages: readonly Message[],
): WaggleHandoffRequest | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (!message) continue
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex]
      if (
        part?.type !== 'tool-result' ||
        part.toolResult.name !== WAGGLE_INVOKE_TOOL_NAME ||
        part.toolResult.isError
      ) {
        continue
      }
      const decoded = safeDecodeUnknown(waggleHandoffRequestSchema, part.toolResult.details)
      if (decoded.success) return toWaggleHandoffRequest(decoded.data)
    }
  }
  return null
}
