import type {
  AgentLoopInteraction,
  AgentLoopInteractionErrorCode,
  AgentLoopInteractionKind,
  AgentLoopInteractionResponse,
  AgentLoopInteractionResponseInput,
  AgentLoopInteractionStatus,
  AgentLoopInteractionSubmitResult,
} from '@shared/types/agent-loop-interaction'
import type { SessionId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'

interface PendingInteraction {
  readonly interaction: Exclude<AgentLoopInteraction, { readonly kind: 'notify' }>
  readonly onEvent: (event: AgentTransportEvent) => void
  readonly fallback: AgentLoopInteractionResponse
  readonly resolve: (response: AgentLoopInteractionResponse) => void
  readonly cleanup: () => void
}

export interface AgentLoopInteractionRequestInput {
  readonly interaction: AgentLoopInteraction
  readonly onEvent: (event: AgentTransportEvent) => void
  readonly signal?: AbortSignal
  readonly fallback?: AgentLoopInteractionResponse
}

const pendingInteractions = new Map<string, PendingInteraction>()
const notifyAckResponse: AgentLoopInteractionResponse = { kind: 'notify', acknowledged: true }

function pendingKey(input: {
  readonly sessionId: SessionId
  readonly runId: string
  readonly interactionId: string
}) {
  return `${String(input.sessionId)}:${input.runId}:${input.interactionId}`
}

function fallbackForKind(kind: AgentLoopInteractionKind): AgentLoopInteractionResponse {
  if (kind === 'confirm') return { kind, accepted: false }
  if (kind === 'select') return { kind, selected: null }
  if (kind === 'input') return { kind, value: null }
  if (kind === 'editor') return { kind, value: null }
  if (kind === 'custom') return { kind, value: null }
  return notifyAckResponse
}

function interactionStatus(response: AgentLoopInteractionResponse): AgentLoopInteractionStatus {
  if (response.kind === 'select' && response.selected === null) return 'cancelled'
  if (response.kind === 'input' && response.value === null) return 'cancelled'
  if (response.kind === 'editor' && response.value === null) return 'cancelled'
  return 'resolved'
}

function emitResolved(input: {
  readonly interaction: AgentLoopInteraction
  readonly response?: AgentLoopInteractionResponse
  readonly status?: AgentLoopInteractionStatus
  readonly error?: {
    readonly code: AgentLoopInteractionErrorCode
    readonly message: string
  }
  readonly onEvent: (event: AgentTransportEvent) => void
}) {
  input.onEvent({
    type: 'agent_interaction_resolved',
    runId: input.interaction.runId,
    interactionId: input.interaction.interactionId,
    kind: input.interaction.kind,
    status: input.status ?? (input.response ? interactionStatus(input.response) : 'resolved'),
    ...(input.response ? { response: input.response } : {}),
    ...(input.error ? { error: input.error } : {}),
    timestamp: Date.now(),
  })
}

function settlePending(input: {
  readonly key: string
  readonly pending: PendingInteraction
  readonly response: AgentLoopInteractionResponse
  readonly status?: AgentLoopInteractionStatus
}) {
  pendingInteractions.delete(input.key)
  input.pending.cleanup()
  emitResolved({
    interaction: input.pending.interaction,
    response: input.response,
    status: input.status,
    onEvent: input.pending.onEvent,
  })
  input.pending.resolve(input.response)
}

function responseMatchesKind(input: {
  readonly kind: AgentLoopInteractionKind
  readonly response: AgentLoopInteractionResponse
}) {
  return input.kind === input.response.kind
}

function selectedChoiceIsValid(input: {
  readonly interaction: Exclude<AgentLoopInteraction, { readonly kind: 'notify' }>
  readonly response: AgentLoopInteractionResponse
}) {
  if (input.interaction.kind !== 'select' || input.response.kind !== 'select') return true
  return (
    input.response.selected === null || input.interaction.choices.includes(input.response.selected)
  )
}

function invalidResponse(message: string): AgentLoopInteractionSubmitResult {
  return { ok: false, error: { code: 'invalid-response-payload', message } }
}

function mismatch(message: string): AgentLoopInteractionSubmitResult {
  return { ok: false, error: { code: 'interaction-mismatch', message } }
}

function isPendingInteraction(
  interaction: AgentLoopInteraction,
): interaction is Exclude<AgentLoopInteraction, { readonly kind: 'notify' }> {
  return interaction.kind !== 'notify'
}

export function requestAgentLoopInteraction(input: AgentLoopInteractionRequestInput) {
  const requestEvent: AgentTransportEvent = {
    type: 'agent_interaction_request',
    interaction: input.interaction,
    timestamp: Date.now(),
  }
  input.onEvent(requestEvent)

  if (!isPendingInteraction(input.interaction)) {
    emitResolved({
      interaction: input.interaction,
      response: notifyAckResponse,
      onEvent: input.onEvent,
    })
    return Promise.resolve(notifyAckResponse)
  }

  const interaction = input.interaction

  return new Promise<AgentLoopInteractionResponse>((resolve) => {
    const key = pendingKey(interaction)
    const fallback = input.fallback ?? fallbackForKind(interaction.kind)
    let timeout: ReturnType<typeof setTimeout> | null = null

    const abort = () => {
      const pending = pendingInteractions.get(key)
      if (!pending) return
      settlePending({ key, pending, response: fallback, status: 'cancelled' })
    }

    const cleanup = () => {
      if (timeout) {
        clearTimeout(timeout)
        timeout = null
      }
      input.signal?.removeEventListener('abort', abort)
    }

    pendingInteractions.set(key, {
      interaction,
      onEvent: input.onEvent,
      fallback,
      resolve,
      cleanup,
    })

    if (input.signal?.aborted) {
      abort()
      return
    }

    input.signal?.addEventListener('abort', abort, { once: true })

    if (input.interaction.timeoutMs !== undefined) {
      timeout = setTimeout(abort, input.interaction.timeoutMs)
    }
  })
}

export function failAgentLoopInteraction(input: {
  readonly interaction: AgentLoopInteraction
  readonly onEvent: (event: AgentTransportEvent) => void
  readonly error: {
    readonly code: AgentLoopInteractionErrorCode
    readonly message: string
  }
}) {
  input.onEvent({
    type: 'agent_interaction_request',
    interaction: input.interaction,
    timestamp: Date.now(),
  })
  emitResolved({
    interaction: input.interaction,
    status: 'errored',
    error: input.error,
    onEvent: input.onEvent,
  })
}

export function submitAgentLoopInteractionResponse(
  input: AgentLoopInteractionResponseInput,
): AgentLoopInteractionSubmitResult {
  const key = pendingKey(input)
  const pending = pendingInteractions.get(key)
  if (!pending) {
    return {
      ok: false,
      error: {
        code: 'interaction-not-found',
        message: 'No pending agent-loop interaction matches this response.',
      },
    }
  }

  if (pending.interaction.kind !== input.kind) {
    return mismatch('Interaction response kind does not match the pending request.')
  }

  if (!responseMatchesKind({ kind: input.kind, response: input.response })) {
    return invalidResponse('Interaction response payload kind does not match the request kind.')
  }

  if (!selectedChoiceIsValid({ interaction: pending.interaction, response: input.response })) {
    return invalidResponse('Selected value is not one of the pending Pi select choices.')
  }

  settlePending({ key, pending, response: input.response })
  return { ok: true, interactionId: input.interactionId, status: interactionStatus(input.response) }
}

export function cancelAgentLoopInteractionsForRun(input: {
  readonly sessionId: SessionId
  readonly runId: string
}) {
  for (const [key, pending] of pendingInteractions) {
    if (
      pending.interaction.sessionId === input.sessionId &&
      pending.interaction.runId === input.runId
    ) {
      settlePending({ key, pending, response: pending.fallback, status: 'cancelled' })
    }
  }
}

export function clearAgentLoopInteractionBrokerForTests() {
  for (const [key, pending] of pendingInteractions) {
    settlePending({ key, pending, response: pending.fallback, status: 'cancelled' })
  }
}
