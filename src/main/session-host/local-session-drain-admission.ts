import { safeDecodeUnknown } from '@shared/schema'
import { actionManagementRequestSchema } from '@shared/schemas/action-management'

/**
 * Commands a draining Session Host still accepts. A drain waits for active work to end, so
 * it must keep accepting the commands that end or unblock that work: reading state,
 * interrupting or cancelling a Run, answering its questions, and stopping an Action or a
 * Workspace setup. Refusing them would leave a Run waiting on an approval nobody can give,
 * and the Host would never exit. Waits are reads that can last many minutes, so they take
 * their own liveness and stay refused.
 */
const SETTLING_CONTRACTS: ReadonlySet<string> = new Set([
  'local-host-v1',
  'session-query-v2',
  'local-compaction-cancel-v1',
  'session-waggle-cancel-v1',
])
const SETTLING_CONTROL_OPERATIONS: ReadonlySet<string> = new Set([
  'interrupt',
  'interrupt-descendants',
  'request-respond',
  'approval-respond',
  'queue-pause',
  'export-cancel',
])
const SETTLING_ACTION_OPERATIONS: ReadonlySet<string> = new Set(['stop', 'stop-setup', 'output'])

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
}

/** Host UI arguments travel as `{ kind: 'value', value }` wire values. */
function settlesActionWork(request: unknown) {
  if (field(request, 'channel') !== 'project-actions:manage') return false
  const args = field(request, 'args')
  const argument: unknown = Array.isArray(args) && args.length === 1 ? args.at(0) : undefined
  if (field(argument, 'kind') !== 'value') return false
  const decoded = safeDecodeUnknown(actionManagementRequestSchema, field(argument, 'value'))
  return decoded.success && SETTLING_ACTION_OPERATIONS.has(decoded.data.operation.type)
}

export function isAdmittedWhileDraining(payload: unknown) {
  const contract = field(payload, 'contract')
  const request = field(payload, 'request')
  if (typeof contract !== 'string') return false
  if (SETTLING_CONTRACTS.has(contract)) return true
  if (contract === 'session-control-v2') {
    const operation = field(field(request, 'command'), 'operation')
    return typeof operation === 'string' && SETTLING_CONTROL_OPERATIONS.has(operation)
  }
  if (contract === 'host-ui-v1') return settlesActionWork(request)
  return false
}
