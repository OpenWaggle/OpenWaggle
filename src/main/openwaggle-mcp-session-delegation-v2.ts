import type { SessionToolInputV2 } from './openwaggle-mcp-session-input-v2'

function delegationContent(input: SessionToolInputV2, message: string | undefined) {
  if (input.operation === 'delegation-request-revision') return input.feedback
  if (
    [
      'delegation-reopen',
      'delegation-cancel',
      'delegation-state',
      'delegation-claim',
      'delegation-conflict-acknowledge',
      'delegation-dependency',
      'delegation-propose-amendment',
      'delegation-amend',
    ].includes(input.operation)
  ) {
    return input.reason
  }
  return message
}

function delegationStateSegment(input: SessionToolInputV2) {
  return input.operation === 'delegation-state' && input.delegationState
    ? [input.delegationState]
    : []
}

function conflictSegment(input: SessionToolInputV2) {
  return input.operation === 'delegation-conflict-acknowledge' && input.conflictId
    ? [input.conflictId]
    : []
}

function dependencySegment(input: SessionToolInputV2) {
  if (input.operation !== 'delegation-dependency') return []
  return [
    input.dependencyAction,
    input.dependencyDelegationId,
    input.dependencyRequiredState,
  ].filter((value): value is string => value !== undefined)
}

function specificationRevisionSegment(input: SessionToolInputV2) {
  return (input.operation === 'delegation-propose-amendment' ||
    input.operation === 'delegation-amend') &&
    input.specificationRevision !== undefined
    ? [String(input.specificationRevision)]
    : []
}

export function mcpDelegationPositionals(input: SessionToolInputV2, message: string | undefined) {
  if (!input.operation.startsWith('delegation-')) return undefined
  if (input.operation === 'delegation-verify') {
    return [
      'verify',
      ...(input.sessionId ? [input.sessionId] : []),
      ...(input.delegationId ? [input.delegationId] : []),
      ...(input.submissionRevision === undefined ? [] : [String(input.submissionRevision)]),
      ...(input.verificationOutcome ? [input.verificationOutcome] : []),
      ...(message ? [message] : []),
    ]
  }
  const action =
    input.operation === 'delegation-conflict-acknowledge'
      ? 'acknowledge-conflict'
      : input.operation.slice('delegation-'.length)
  const content = delegationContent(input, message)
  return [
    action,
    ...(input.sessionId ? [input.sessionId] : []),
    ...(input.delegationId ? [input.delegationId] : []),
    ...delegationStateSegment(input),
    ...conflictSegment(input),
    ...dependencySegment(input),
    ...specificationRevisionSegment(input),
    ...(input.submissionRevision === undefined ? [] : [String(input.submissionRevision)]),
    ...(content ? [content] : []),
  ]
}
