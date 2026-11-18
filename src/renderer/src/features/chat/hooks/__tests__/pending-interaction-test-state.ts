function interactionId(value: unknown) {
  return typeof value === 'object' &&
    value !== null &&
    'interactionId' in value &&
    typeof value.interactionId === 'string'
    ? value.interactionId
    : undefined
}

export function recordPendingInteractionEvent(
  pendingInteractionsBySessionId: Map<string, readonly unknown[]>,
  payload: unknown,
) {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('sessionId' in payload) ||
    typeof payload.sessionId !== 'string' ||
    !('event' in payload) ||
    typeof payload.event !== 'object' ||
    payload.event === null ||
    !('type' in payload.event)
  ) {
    return
  }
  const sessionId = payload.sessionId
  const event = payload.event
  const current = pendingInteractionsBySessionId.get(sessionId) ?? []
  if (event.type === 'agent_interaction_request' && 'interaction' in event) {
    const requestedId = interactionId(event.interaction)
    pendingInteractionsBySessionId.set(sessionId, [
      ...current.filter((interaction) => interactionId(interaction) !== requestedId),
      event.interaction,
    ])
  }
  if (event.type === 'agent_interaction_resolved' && 'interactionId' in event) {
    pendingInteractionsBySessionId.set(
      sessionId,
      current.filter((interaction) => interactionId(interaction) !== event.interactionId),
    )
  }
}
