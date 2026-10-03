import { toWaggleInvocation } from '@shared/schemas/waggle'
import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type {
  SessionControlFollowUpInput,
  SessionControlMessageInput,
} from '@shared/types/session-control-run-commands'
import type { RunStartSettings } from '../domain/session-control/run-start-settings'

/** The message content a Follow-up intent snapshot keeps; never a thinking level. */
export function toSessionControlIntentMessage(input: SessionControlFollowUpInput) {
  return {
    text: input.text,
    attachmentIds: input.attachmentIds,
    ...(input.waggle ? { waggle: toWaggleInvocation(input.waggle) } : {}),
    ...(input.visualizationContext ? { visualizationContext: input.visualizationContext } : {}),
  }
}

/** The Session settings a Run-starting command asked for, before any caller ceiling applies. */
export function requestedRunStartSettings(
  input: SessionControlMessageInput,
  runAuthorizationOverride: AgentAuthorizationMode | undefined,
): RunStartSettings {
  return {
    ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
    ...(runAuthorizationOverride ? { runAuthorizationOverride } : {}),
  }
}
