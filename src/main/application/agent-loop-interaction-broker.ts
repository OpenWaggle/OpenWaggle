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
  readonly reject: (error: Error) => void
  readonly cleanup: () => void
}

export interface AgentLoopInteractionRequestInput {
  readonly interaction: AgentLoopInteraction
  readonly onEvent: (event: AgentTransportEvent) => void
  readonly signal?: AbortSignal
  readonly fallback?: AgentLoopInteractionResponse
}

const pendingInteractions = new Map<string, PendingInteraction>()
const runInteractionDeadlines = new Map<
  string,
  { readonly timeoutMs: number; readonly onTimeout: () => void }
>()
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

function expirePendingInteraction(key: string, pending: PendingInteraction) {
  pendingInteractions.delete(key)
  pending.cleanup()
  const error = new Error('The Run interaction deadline expired.')
  emitResolved({
    interaction: pending.interaction,
    status: 'errored',
    error: { code: 'interaction-timeout', message: error.message },
    onEvent: pending.onEvent,
  })
  runInteractionDeadlines.get(pending.interaction.runId)?.onTimeout()
  pending.reject(error)
}

export function registerAgentLoopInteractionDeadline(input: {
  readonly runId: string
  readonly timeoutMs: number
  readonly onTimeout: () => void
}) {
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 0) {
    throw new Error('Run interaction timeout must be a non-negative safe integer.')
  }
  const deadline = { timeoutMs: input.timeoutMs, onTimeout: input.onTimeout }
  runInteractionDeadlines.set(input.runId, deadline)
  return () => {
    if (runInteractionDeadlines.get(input.runId) === deadline) {
      runInteractionDeadlines.delete(input.runId)
    }
  }
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

  return new Promise<AgentLoopInteractionResponse>((resolve, reject) => {
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
      reject,
      cleanup,
    })

    if (input.signal?.aborted) {
      abort()
      return
    }

    input.signal?.addEventListener('abort', abort, { once: true })

    const runDeadline = runInteractionDeadlines.get(interaction.runId)
    if (
      runDeadline &&
      (interaction.timeoutMs === undefined || runDeadline.timeoutMs <= interaction.timeoutMs)
    ) {
      timeout = setTimeout(() => {
        const pending = pendingInteractions.get(key)
        if (pending) expirePendingInteraction(key, pending)
      }, runDeadline.timeoutMs)
      return
    }
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
  channel?: 'approval' | 'response',
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

  const isAuthorization =
    pending.interaction.kind === 'confirm' && pending.interaction.purpose === 'authorization'
  if ((channel === 'approval' && !isAuthorization) || (channel === 'response' && isAuthorization)) {
    return mismatch(
      isAuthorization
        ? 'Authorization requests require sessions:approve authority.'
        : 'This interaction requires sessions:respond authority.',
    )
  }

  if (!responseMatchesKind({ kind: input.kind, response: input.response })) {
    return invalidResponse('Interaction response payload kind does not match the request kind.')
  }

  if (!selectedChoiceIsValid({ interaction: pending.interaction, response: input.response })) {
    return invalidResponse('Selected value is not one of the pending select choices.')
  }

  settlePending({ key, pending, response: input.response })
  return { ok: true, interactionId: input.interactionId, status: interactionStatus(input.response) }
}

export function listPendingAgentLoopInteractions(sessionId?: SessionId) {
  const interactions: AgentLoopInteraction[] = []
  for (const pending of pendingInteractions.values()) {
    if (sessionId === undefined || pending.interaction.sessionId === sessionId) {
      interactions.push(pending.interaction)
    }
  }
  return interactions.sort(
    (left, right) =>
      left.createdAt - right.createdAt || left.interactionId.localeCompare(right.interactionId),
  )
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
  runInteractionDeadlines.clear()
}
