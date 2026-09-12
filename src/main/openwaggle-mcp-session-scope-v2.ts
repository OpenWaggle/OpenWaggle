import { matchBy } from '@diegogbrisa/ts-match'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import type { OpenWaggleMcpServeOptions } from './openwaggle-mcp-server-policy'
import { assertProjectAllowed } from './openwaggle-mcp-workspace-policy'

export function mcpSessionPathAllowed(
  roots: readonly string[],
  candidate: string | null | undefined,
) {
  if (!candidate) return false
  try {
    assertProjectAllowed({ workspaceRoots: roots, sessionIds: new Set() }, candidate)
    return true
  } catch {
    return false
  }
}

function controlTarget(
  payload: Extract<LocalSessionCommandPayload, { contract: 'session-control-v2' }>,
) {
  const command = payload.request.command
  if (command.operation !== 'report') return command.sessionId
  if (command.target.type === 'session') return [command.sessionId, command.target.sessionId]
  if (command.target.type === 'sessions') return [command.sessionId, ...command.target.sessionIds]
  return command.sessionId
}

function lifecycleTarget(
  payload: Extract<LocalSessionCommandPayload, { contract: 'session-lifecycle-v2' }>,
) {
  const command = payload.request.command
  if (command.operation === 'spawn') return command.parentSessionId
  return command.operation === 'fork' ? command.sourceSessionId : undefined
}

function queryTarget(
  payload: Extract<LocalSessionCommandPayload, { contract: 'session-query-v2' }>,
) {
  const query = payload.request.query
  if (query.operation === 'list' || query.operation === 'search') return
  if (query.operation === 'delegations-list' || query.operation === 'delegations-conflicts') {
    return [query.parentSessionId, query.workerSessionId].filter(
      (sessionId): sessionId is string => sessionId !== undefined,
    )
  }
  if (query.operation === 'delegations-read') return
  if (query.operation === 'wait') return query.targets.map((target) => target.sessionId)
  return query.sessionId
}

function directTarget(payload: LocalSessionCommandPayload) {
  return matchBy(payload, 'contract')
    .with(
      'local-ui-v1',
      'local-attachments-v1',
      'local-compaction-v1',
      'local-compaction-cancel-v1',
      'host-ui-v1',
      'desktop-service-v1',
      () => {
        throw new Error('Local GUI contracts are not available through the Sessions MCP adapter.')
      },
    )
    .with('session-waggle-v1', 'session-waggle-cancel-v1', () => {
      throw new Error(
        'Explicit GUI Waggle contracts are not available through the Sessions MCP adapter.',
      )
    })
    .with('local-access-v1', () => undefined)
    .with('session-control-v2', controlTarget)
    .with('session-lifecycle-v2', lifecycleTarget)
    .with('session-query-v2', queryTarget)
    .exhaustive()
}

function resultOutcome(value: unknown) {
  if (typeof value !== 'object' || value === null || !('response' in value)) return
  const response = value.response
  if (typeof response !== 'object' || response === null || !('outcome' in response)) return
  return response.outcome
}

function replaceResultOutcome(value: unknown, outcome: object) {
  if (typeof value !== 'object' || value === null || !('response' in value)) return value
  const response = value.response
  return typeof response === 'object' && response !== null
    ? { ...value, response: { ...response, outcome } }
    : value
}

function sessionSummaryAllowed(options: OpenWaggleMcpServeOptions, value: unknown) {
  if (typeof value !== 'object' || value === null || !('sessionId' in value)) return false
  const sessionId = value.sessionId
  if (typeof sessionId !== 'string') return false
  if (options.sessionIds.has(sessionId)) return true
  const projectPath = 'projectPath' in value ? value.projectPath : undefined
  return mcpSessionPathAllowed(
    options.workspaceRoots,
    typeof projectPath === 'string' ? projectPath : undefined,
  )
}

function workerSessionId(value: unknown) {
  if (typeof value !== 'object' || value === null || !('workerSessionId' in value)) return
  return typeof value.workerSessionId === 'string' ? value.workerSessionId : undefined
}

function projectPathFromReadResult(read: unknown) {
  const outcome = resultOutcome(read)
  if (typeof outcome !== 'object' || outcome === null || !('session' in outcome)) return
  const session = outcome.session
  if (typeof session !== 'object' || session === null || !('projectPath' in session)) return
  return session.projectPath
}

async function sessionIdAllowed(
  options: OpenWaggleMcpServeOptions,
  execute: (payload: LocalSessionCommandPayload) => Promise<unknown>,
  sessionId: string,
) {
  if (options.sessionIds.has(sessionId)) return true
  const read = await execute({
    contract: 'session-query-v2',
    request: {
      contractVersion: SESSION_QUERY_CONTRACT_VERSION,
      requestId: `scope:${sessionId}`,
      query: { operation: 'read', sessionId },
    },
  })
  const projectPath = projectPathFromReadResult(read)
  return mcpSessionPathAllowed(
    options.workspaceRoots,
    typeof projectPath === 'string' ? projectPath : null,
  )
}

export async function filterMcpSessionQueryResult(
  options: OpenWaggleMcpServeOptions,
  _execute: (payload: LocalSessionCommandPayload) => Promise<unknown>,
  value: unknown,
) {
  const outcome = resultOutcome(value)
  if (typeof outcome !== 'object' || outcome === null || !('operation' in outcome)) return value
  if (
    (outcome.operation === 'list' || outcome.operation === 'search') &&
    'sessions' in outcome &&
    Array.isArray(outcome.sessions)
  ) {
    return replaceResultOutcome(value, {
      ...outcome,
      sessions: outcome.sessions.filter((session) => sessionSummaryAllowed(options, session)),
    })
  }
  // Delegation and conflict repository queries already apply the transient Session Host
  // authority in SQL. Re-reading every returned Worker here would open one Host connection per
  // row (twice per conflict) and can exceed the global connection cap for one valid page.
  return value
}

function workerFromDelegationResult(read: unknown) {
  const outcome = resultOutcome(read)
  if (typeof outcome !== 'object' || outcome === null || !('delegation' in outcome)) return
  return workerSessionId(outcome.delegation)
}

export async function prepareMcpSessionTargetScope(
  options: OpenWaggleMcpServeOptions,
  execute: (payload: LocalSessionCommandPayload) => Promise<unknown>,
  payload: LocalSessionCommandPayload,
) {
  const targets =
    payload.contract === 'session-query-v2' &&
    payload.request.query.operation === 'delegations-read'
      ? [workerFromDelegationResult(await execute(payload))].filter(
          (sessionId): sessionId is string => sessionId !== undefined,
        )
      : directTarget(payload)
  for (const sessionId of Array.isArray(targets) ? targets : targets ? [targets] : []) {
    if (await sessionIdAllowed(options, execute, sessionId)) continue
    throw new Error(`Session ${JSON.stringify(sessionId)} was not found in the granted scope.`)
  }
  return payload
}
