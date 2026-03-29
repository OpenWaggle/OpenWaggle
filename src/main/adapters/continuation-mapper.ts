/// <reference path="./tanstack-chat-overload.d.ts" />

/**
 * Continuation message adapter — bridges domain continuation types to vendor types.
 */
import type {
  DomainContinuationMessage,
  DomainModelContinuationMessage,
} from '@shared/types/continuation'
import { convertMessagesToModelMessages } from '@tanstack/ai'

/**
 * Runtime type guard: validates that a vendor ModelMessage has the
 * DomainModelContinuationMessage shape. Used at the adapter boundary
 * to narrow vendor results to domain types without compile-time casts.
 */

/**
 * Convert domain continuation messages to vendor ModelMessages via TanStack AI's
 * `convertMessagesToModelMessages`, then validate back to domain types.
 *
 * Uses the permissive overload from tanstack-chat-overload.d.ts to accept unknown[].
 * Used only by the `normalizeContinuationInput` path (test-only).
 */
export function convertDomainToModelMessages(
  messages: readonly DomainContinuationMessage[],
): DomainModelContinuationMessage[] {
  const vendorResult = convertMessagesToModelMessages([...messages])
  // Map vendor ModelMessage[] → domain types by extracting known fields.
  return vendorResult.map((msg) => {
    const domain: DomainModelContinuationMessage = {
      role: msg.role,
      content: typeof msg.content === 'string' || msg.content === null ? msg.content : null,
      name: msg.name,
      toolCalls: msg.toolCalls?.map((tc) => ({
        id: tc.id,
        type: tc.type,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
      toolCallId: msg.toolCallId,
    }
    return domain
  })
}
