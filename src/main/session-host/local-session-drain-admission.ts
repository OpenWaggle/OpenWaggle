import { safeDecodeUnknown } from '@shared/schema'
import { actionManagementRequestSchema } from '@shared/schemas/action-management'
import { hostBackedGuiChannelSchema } from '@shared/schemas/host-ui-protocol'
import { isReadOnlyHostUiInvocation } from '../application/host-ui-read-only-invocation'

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

/** Host UI arguments travel as `{ kind: 'value', value }` or `{ kind: 'undefined' }`. */
function hostUiArguments(request: unknown): readonly unknown[] | undefined {
  const args = field(request, 'args')
  if (!Array.isArray(args)) return undefined
  const kinds = args.map((argument) => field(argument, 'kind'))
  if (kinds.some((kind) => kind !== 'undefined' && kind !== 'value')) return undefined
  return args.map((argument) => field(argument, 'value'))
}

function settlesActionWork(channel: string, args: readonly unknown[]) {
  if (channel !== 'project-actions:manage' || args.length !== 1) return false
  const decoded = safeDecodeUnknown(actionManagementRequestSchema, args[0])
  return decoded.success && SETTLING_ACTION_OPERATIONS.has(decoded.data.operation.type)
}

/**
 * The desktop app reads everything through Host UI requests, so its reads are admitted too:
 * a user who opens the app to answer an approval must be able to load the Session.
 */
function admitsHostUiRequest(request: unknown) {
  const channel = safeDecodeUnknown(hostBackedGuiChannelSchema, field(request, 'channel'))
  const args = hostUiArguments(request)
  if (!channel.success || !args) return false
  return settlesActionWork(channel.data, args) || isReadOnlyHostUiInvocation(channel.data, args)
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
  if (contract === 'host-ui-v1') return admitsHostUiRequest(request)
  return false
}
