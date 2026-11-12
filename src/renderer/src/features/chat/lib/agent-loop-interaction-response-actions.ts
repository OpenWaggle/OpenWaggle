import { matchBy } from '@diegogbrisa/ts-match'
import { safeDecodeUnknown } from '@shared/schema'
import { agentLoopResponseSchema } from '@shared/schemas/agent-loop-interaction'
import type {
  AgentLoopInteraction,
  AgentLoopInteractionResponse,
} from '@shared/types/agent-loop-interaction'
import type { JsonValue } from '@shared/types/json'
import {
  CUSTOM_INTERACTION_RESPONSE_ACTION_ID,
  CUSTOM_INTERACTION_UNAVAILABLE_ACTION_ID,
} from '@/features/extensions'

function typedResponseFromPayload(
  interaction: AgentLoopInteraction,
  payload: JsonValue | undefined,
) {
  if (payload === undefined) {
    return null
  }

  const decoded = safeDecodeUnknown(agentLoopResponseSchema, payload)
  return decoded.success && decoded.data.kind === interaction.kind ? decoded.data : null
}

export function responseFromExtensionAction(input: {
  readonly interaction: AgentLoopInteraction
  readonly actionId: string
  readonly payload?: JsonValue
}): AgentLoopInteractionResponse | null {
  const typedResponse = typedResponseFromPayload(input.interaction, input.payload)
  if (input.actionId === CUSTOM_INTERACTION_RESPONSE_ACTION_ID && typedResponse !== null) {
    return typedResponse
  }

  return matchBy(input.interaction, 'kind')
    .with('confirm', () => {
      if (input.actionId === 'accept') return { kind: 'confirm', accepted: true }
      if (input.actionId === 'reject') return { kind: 'confirm', accepted: false }
      return null
    })
    .with('select', (interaction) => {
      if (input.actionId === 'cancel') return { kind: 'select', selected: null }
      return interaction.choices.includes(input.actionId)
        ? { kind: 'select', selected: input.actionId }
        : null
    })
    .with('input', () => {
      if (input.actionId === 'cancel') return { kind: 'input', value: null }
      return input.actionId === 'submit' && typeof input.payload === 'string'
        ? { kind: 'input', value: input.payload }
        : null
    })
    .with('editor', () => {
      if (input.actionId === 'cancel') return { kind: 'editor', value: null }
      return input.actionId === 'submit' && typeof input.payload === 'string'
        ? { kind: 'editor', value: input.payload }
        : null
    })
    .with('notify', () =>
      input.actionId === 'acknowledge' ? { kind: 'notify', acknowledged: true } : null,
    )
    .with('custom', () => {
      if (input.actionId === CUSTOM_INTERACTION_UNAVAILABLE_ACTION_ID) {
        return { kind: 'custom', value: null }
      }
      if (input.actionId === CUSTOM_INTERACTION_RESPONSE_ACTION_ID) {
        return { kind: 'custom', value: input.payload ?? null }
      }
      return null
    })
    .exhaustive()
}
