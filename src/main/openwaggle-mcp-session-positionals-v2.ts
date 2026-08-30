import { mcpDelegationPositionals } from './openwaggle-mcp-session-delegation-v2'
import type { SessionToolInputV2 } from './openwaggle-mcp-session-input-v2'

function catalogQueryPositionals(input: SessionToolInputV2, message: string | undefined) {
  if (input.operation === 'list') return []
  if (input.operation === 'search') return message ? [message] : []
  if (input.operation === 'wait') {
    return input.sessionIds ?? (input.sessionId ? [input.sessionId] : [])
  }
  return undefined
}

function delegationQueryPositionals(input: SessionToolInputV2) {
  if (input.operation === 'delegations-list' || input.operation === 'delegations-conflicts')
    return []
  return input.operation === 'delegations-read' && input.delegationId
    ? [input.delegationId]
    : undefined
}

function exportQueryPositionals(input: SessionToolInputV2) {
  if (input.operation === 'exports-list') {
    return ['list', ...(input.sessionId ? [input.sessionId] : [])]
  }
  if (input.operation !== 'exports-read' && input.operation !== 'exports-wait') return undefined
  return [
    input.operation === 'exports-read' ? 'read' : 'wait',
    ...(input.sessionId ? [input.sessionId] : []),
    ...(input.exportOperationId ? [input.exportOperationId] : []),
  ]
}

function exportControlPositionals(input: SessionToolInputV2) {
  if (input.operation === 'export-create') {
    return [
      'create',
      ...(input.sessionId ? [input.sessionId] : []),
      ...(input.destinationPath ? [input.destinationPath] : []),
    ]
  }
  if (input.operation !== 'export-cancel') return undefined
  return [
    'cancel',
    ...(input.sessionId ? [input.sessionId] : []),
    ...(input.exportOperationId ? [input.exportOperationId] : []),
  ]
}

function lifecyclePositionals(input: SessionToolInputV2) {
  if (input.operation === 'create') return input.projectPath ? [input.projectPath] : []
  if (input.operation === 'launch') {
    return input.projectPath ? [input.projectPath] : []
  }
  if (input.operation === 'fork') return input.sessionId ? [input.sessionId] : []
  if (input.operation !== 'spawn') return undefined
  return input.sessionId ? [input.sessionId] : []
}

function queuePositionals(input: SessionToolInputV2) {
  const direct = input.sessionId ? [input.sessionId] : []
  if (input.operation === 'queue-list') return ['list', ...direct]
  if (input.operation === 'queue-withdraw')
    return ['withdraw', ...direct, ...(input.followUpIds ?? [])]
  if (input.operation === 'queue-reorder')
    return ['reorder', ...direct, ...(input.followUpIds ?? [])]
  if (input.operation === 'queue-pause') return ['pause', ...direct]
  if (input.operation === 'queue-update-authorization') {
    return ['update-authorization', ...direct, ...(input.followUpId ? [input.followUpId] : [])]
  }
  return input.operation === 'queue-resume' ? ['resume', ...direct] : undefined
}

function requestPositionals(input: SessionToolInputV2) {
  if (input.operation === 'requests-list') {
    return ['list', ...(input.sessionId ? [input.sessionId] : [])]
  }
  if (input.operation !== 'request-respond' && input.operation !== 'approval-respond') {
    return undefined
  }
  return [
    'respond',
    ...(input.sessionId ? [input.sessionId] : []),
    ...(input.runId ? [input.runId] : []),
    ...(input.interactionId ? [input.interactionId] : []),
  ]
}

function authorizationPositionals(input: SessionToolInputV2) {
  if (input.operation !== 'authorization-set') return undefined
  if (input.authorizationMode === 'inherit') {
    return ['clear', ...(input.sessionId ? [input.sessionId] : [])]
  }
  return [
    'set',
    ...(input.sessionId ? [input.sessionId] : []),
    ...(input.authorizationMode ? [input.authorizationMode] : []),
  ]
}

function directPositionals(input: SessionToolInputV2, message: string | undefined) {
  const direct = input.sessionId ? [input.sessionId] : []
  if (input.operation === 'promote') {
    return [...direct, ...(input.followUpId ? [input.followUpId] : [])]
  }
  if (['message', 'start', 'follow-up', 'steer', 'replace', 'report'].includes(input.operation)) {
    return direct
  }
  return input.operation === 'rename' ? [...direct, ...(message ? [message] : [])] : direct
}

export function mcpSessionPositionalsV2(input: SessionToolInputV2, message: string | undefined) {
  const resolved =
    catalogQueryPositionals(input, message) ??
    delegationQueryPositionals(input) ??
    exportQueryPositionals(input) ??
    exportControlPositionals(input) ??
    lifecyclePositionals(input) ??
    queuePositionals(input) ??
    requestPositionals(input) ??
    authorizationPositionals(input) ??
    mcpDelegationPositionals(input, message)
  if (resolved) return resolved
  return directPositionals(input, message)
}
