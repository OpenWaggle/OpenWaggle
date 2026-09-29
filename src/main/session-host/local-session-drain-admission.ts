import { safeDecodeUnknown } from '@shared/schema'
import { actionManagementRequestSchema } from '@shared/schemas/action-management'
import { hostUiV1RequestSchema } from '@shared/schemas/host-ui-protocol'
import { isReadOnlyHostUiInvocation } from '../application/host-ui-read-only-invocation'

/**
 * Commands a draining Session Host still accepts. A drain waits for active work to end, so
 * it must keep accepting the commands that end or unblock that work: reading state,
 * interrupting or cancelling a Run, answering its questions, and stopping an Action or a
 * Workspace setup. Refusing them would leave a Run waiting on an approval nobody can give,
 * and the Host would never exit. Waits, including searches that wait for fresh results,
 * can last many minutes, so they stay refused.
 */
const SETTLING_CONTRACTS: ReadonlySet<string> = new Set([
  'local-host-v1',
  'local-compaction-cancel-v1',
  'session-waggle-cancel-v1',
])
const WAITING_QUERY_OPERATIONS: ReadonlySet<string> = new Set(['wait', 'exports-wait'])
/**
 * Replay-safe reads that still do work on the Host: listing MCP capabilities connects to
 * (and may start) MCP servers, and context usage builds a Pi session.
 */
const WORKING_HOST_UI_READS: ReadonlySet<string> = new Set([
  'mcp:list-capabilities',
  'agent:get-context-usage',
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

function admitsQuery(request: unknown) {
  const query = field(request, 'query')
  const operation = field(query, 'operation')
  if (typeof operation !== 'string' || WAITING_QUERY_OPERATIONS.has(operation)) return false
  const waitsForFreshResults =
    operation === 'search' &&
    field(query, 'mode') !== 'lexical' &&
    field(query, 'requireFresh') === true &&
    Number(field(query, 'waitTimeoutMs') ?? 0) > 0
  return !waitsForFreshResults
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
  const decoded = safeDecodeUnknown(hostUiV1RequestSchema, request)
  if (!decoded.success) return false
  const { channel } = decoded.data
  // Arguments travel as `{ kind: 'value', value }` or `{ kind: 'undefined' }`.
  const args = decoded.data.args.map((argument) =>
    argument.kind === 'value' ? argument.value : undefined,
  )
  if (settlesActionWork(channel, args)) return true
  return !WORKING_HOST_UI_READS.has(channel) && isReadOnlyHostUiInvocation(channel, args)
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
  if (contract === 'session-query-v2') return admitsQuery(request)
  if (contract === 'host-ui-v1') return admitsHostUiRequest(request)
  return false
}
