import type { McpEffectiveState, McpIntegrationState, McpScopeResolution } from '@shared/types/mcp'

interface ActiveMcpTurn {
  readonly applied: McpEffectiveState
  readonly revision: string | null
}

const activeTurns = new Map<string, ActiveMcpTurn>()

export function beginMcpTurn(sessionId: string, revision: string | null) {
  activeTurns.set(sessionId, { applied: revision ? 'on' : 'off', revision })
}

export function completeMcpTurn(sessionId: string) {
  activeTurns.delete(sessionId)
}

export function isMcpTurnActive(sessionId: string) {
  return activeTurns.has(sessionId)
}

export function clearMcpTurnApplications() {
  activeTurns.clear()
}

export function resolveMcpIntegrationState(input: {
  readonly sessionId: string | null
  readonly desired: McpScopeResolution
  readonly desiredRevision: string | null
}): McpIntegrationState {
  const active = input.sessionId ? activeTurns.get(input.sessionId) : undefined
  if (!active) {
    return { desired: input.desired, applied: input.desired.effective, applyState: 'applied' }
  }
  const pending = active.revision !== input.desiredRevision
  return {
    desired: input.desired,
    applied: active.applied,
    applyState: pending ? 'pending' : 'applied',
    ...(pending
      ? { pendingReason: 'The active turn keeps its immutable MCP snapshot until it settles.' }
      : {}),
  }
}
