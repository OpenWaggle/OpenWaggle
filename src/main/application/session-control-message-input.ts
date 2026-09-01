import { toWaggleInvocation } from '@shared/schemas/waggle'
import type { SessionControlMessageInput } from '@shared/types/session-control-run-commands'

export function toSessionControlIntentMessage(input: SessionControlMessageInput) {
  return {
    text: input.text,
    attachmentIds: input.attachmentIds,
    ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
    ...(input.waggle ? { waggle: toWaggleInvocation(input.waggle) } : {}),
    ...(input.visualizationContext ? { visualizationContext: input.visualizationContext } : {}),
  }
}
