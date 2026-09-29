/**
 * Commands a draining Session Host still accepts. A drain waits for active work to end, so
 * it must keep accepting the commands that end or unblock that work: reading state,
 * interrupting a Run, answering its questions, and stopping an Action. Refusing them would
 * leave a Run waiting on an approval nobody can give, and the Host would never exit.
 */
const SETTLING_CONTROL_OPERATIONS: ReadonlySet<string> = new Set([
  'interrupt',
  'interrupt-descendants',
  'request-respond',
  'approval-respond',
  'queue-pause',
  'export-cancel',
])
const SETTLING_ACTION_OPERATIONS: ReadonlySet<string> = new Set(['stop', 'output'])

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
}

function settlesActionWork(request: unknown) {
  if (field(request, 'channel') !== 'project-actions:manage') return false
  const args = field(request, 'args')
  const management: unknown = Array.isArray(args) ? args.at(0) : undefined
  const operationType = field(field(management, 'operation'), 'type')
  return typeof operationType === 'string' && SETTLING_ACTION_OPERATIONS.has(operationType)
}

export function isAdmittedWhileDraining(payload: unknown) {
  const contract = field(payload, 'contract')
  const request = field(payload, 'request')
  if (contract === 'local-host-v1' || contract === 'session-query-v2') return true
  if (contract === 'session-control-v2') {
    const operation = field(field(request, 'command'), 'operation')
    return typeof operation === 'string' && SETTLING_CONTROL_OPERATIONS.has(operation)
  }
  if (contract === 'host-ui-v1') return settlesActionWork(request)
  return false
}
