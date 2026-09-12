import { randomUUID } from 'node:crypto'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import {
  SESSION_QUERY_CONTRACT_VERSION,
  SESSION_QUERY_DISCOVERY_LIMIT,
} from '@shared/types/session-query'
import { option, type ParsedArguments } from './mcp-cli-arguments'
import { nonNegativeInteger, positiveInteger, required } from './sessions-cli-arguments'

export function itemsPayload(arguments_: ParsedArguments): LocalSessionCommandPayload {
  const sessionId = required(arguments_.positionals[0], 'Session ID')
  const branchScope = option(arguments_, 'scope') ?? 'active-branch'
  if (branchScope !== 'active-branch' && branchScope !== 'tree') {
    throw new Error('--scope must be active-branch or tree.')
  }
  if (branchScope === 'tree' && option(arguments_, 'branch')) {
    throw new Error('--branch requires --scope active-branch.')
  }
  return {
    contract: 'session-query-v2',
    request: {
      contractVersion: SESSION_QUERY_CONTRACT_VERSION,
      requestId: randomUUID(),
      query: {
        operation: 'items',
        sessionId,
        branchScope,
        ...(option(arguments_, 'branch') ? { branchId: option(arguments_, 'branch') } : {}),
        ...(option(arguments_, 'run') ? { runId: option(arguments_, 'run') } : {}),
        limit: option(arguments_, 'limit')
          ? positiveInteger(option(arguments_, 'limit'), '--limit')
          : SESSION_QUERY_DISCOVERY_LIMIT,
        ...(option(arguments_, 'after')
          ? { afterCreatedOrder: nonNegativeInteger(option(arguments_, 'after'), '--after') }
          : {}),
        ...(option(arguments_, 'through')
          ? { throughCreatedOrder: nonNegativeInteger(option(arguments_, 'through'), '--through') }
          : {}),
        ...(option(arguments_, 'snapshot-head')
          ? { snapshotHeadNodeId: option(arguments_, 'snapshot-head') }
          : {}),
      },
    },
  }
}
