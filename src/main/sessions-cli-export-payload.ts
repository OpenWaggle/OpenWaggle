import { randomUUID } from 'node:crypto'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import {
  SESSION_QUERY_CONTRACT_VERSION,
  SESSION_QUERY_TRANSCRIPT_LIMIT,
} from '@shared/types/session-query'
import { hasFlag, option, type ParsedArguments } from './mcp-cli-arguments'
import { positiveInteger, required } from './sessions-cli-arguments'

export function buildSessionsCliExportPayload(
  arguments_: ParsedArguments,
): LocalSessionCommandPayload {
  const branchScope = option(arguments_, 'scope') ?? 'active-branch'
  if (branchScope !== 'active-branch' && branchScope !== 'tree') {
    throw new Error('Unsupported export scope. Expected active-branch or tree.')
  }
  return {
    contract: 'session-query-v2',
    request: {
      contractVersion: SESSION_QUERY_CONTRACT_VERSION,
      requestId: randomUUID(),
      query: {
        operation: 'export',
        sessionId: required(arguments_.positionals[0], 'Session ID'),
        limit: option(arguments_, 'limit')
          ? positiveInteger(option(arguments_, 'limit'), '--limit')
          : SESSION_QUERY_TRANSCRIPT_LIMIT,
        branchScope,
        ...(option(arguments_, 'branch') ? { branchId: option(arguments_, 'branch') } : {}),
        ...(hasFlag(arguments_, 'include-queue-bodies') ? { includeQueueBodies: true } : {}),
      },
    },
  }
}
