import { randomUUID } from 'node:crypto'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { DELEGATION_STATES, type DelegationState } from '@shared/types/session-collaboration'
import {
  DELEGATION_CONFLICT_KINDS,
  DELEGATION_CONFLICT_STATUSES,
  type DelegationConflictKind,
  type DelegationConflictStatus,
} from '@shared/types/session-delegation-query'
import {
  SESSION_QUERY_CONTRACT_VERSION,
  SESSION_QUERY_DISCOVERY_LIMIT,
} from '@shared/types/session-query'
import { resolveCliProjectPath } from './cli-project-path'
import { hasFlag, option, type ParsedArguments } from './mcp-cli-arguments'
import { positiveInteger, required } from './sessions-cli-arguments'
import { buildSessionsCliControlPayload } from './sessions-cli-control-payload'

const DELEGATION_MUTATION_COMMANDS = new Set([
  'submit',
  'claim',
  'acknowledge-conflict',
  'dependency',
  'propose-amendment',
  'amend',
  'verify',
  'state',
  'request-revision',
  'accept',
  'reopen',
  'cancel',
])

function selectedStates(arguments_: ParsedArguments): readonly DelegationState[] | undefined {
  const values = arguments_.options.get('state')
  if (!values?.length) return undefined
  return values.map((value) => {
    const state = DELEGATION_STATES.find((candidate) => candidate === value)
    if (!state) throw new Error(`Unsupported Delegation state: ${value}.`)
    return state
  })
}

function listPayload(
  arguments_: ParsedArguments,
  workingDirectory: string,
): LocalSessionCommandPayload {
  const states = selectedStates(arguments_)
  const projectPath = option(arguments_, 'project')
  return {
    contract: 'session-query-v2',
    request: {
      contractVersion: SESSION_QUERY_CONTRACT_VERSION,
      requestId: randomUUID(),
      query: {
        operation: 'delegations-list',
        limit: option(arguments_, 'limit')
          ? positiveInteger(option(arguments_, 'limit'), '--limit')
          : SESSION_QUERY_DISCOVERY_LIMIT,
        ...(option(arguments_, 'cursor') ? { cursor: option(arguments_, 'cursor') } : {}),
        ...(hasFlag(arguments_, 'all')
          ? {}
          : projectPath
            ? { projectPath: resolveCliProjectPath(projectPath, workingDirectory) }
            : { workingPath: workingDirectory }),
        ...(option(arguments_, 'parent') ? { parentSessionId: option(arguments_, 'parent') } : {}),
        ...(option(arguments_, 'worker') ? { workerSessionId: option(arguments_, 'worker') } : {}),
        ...(states ? { states } : {}),
      },
    },
  }
}

function readPayload(arguments_: ParsedArguments): LocalSessionCommandPayload {
  return {
    contract: 'session-query-v2',
    request: {
      contractVersion: SESSION_QUERY_CONTRACT_VERSION,
      requestId: randomUUID(),
      query: {
        operation: 'delegations-read',
        delegationId: required(arguments_.positionals[0], 'Delegation ID'),
      },
    },
  }
}

function selectedConflictKinds(arguments_: ParsedArguments): readonly DelegationConflictKind[] {
  return (arguments_.options.get('kind') ?? []).map((value) => {
    const kind = DELEGATION_CONFLICT_KINDS.find((candidate) => candidate === value)
    if (!kind) throw new Error(`Unsupported Delegation conflict kind: ${value}.`)
    return kind
  })
}

function selectedConflictStatuses(
  arguments_: ParsedArguments,
): readonly DelegationConflictStatus[] {
  return (arguments_.options.get('status') ?? []).map((value) => {
    const status = DELEGATION_CONFLICT_STATUSES.find((candidate) => candidate === value)
    if (!status) throw new Error(`Unsupported Delegation conflict status: ${value}.`)
    return status
  })
}

function conflictsPayload(
  arguments_: ParsedArguments,
  workingDirectory: string,
): LocalSessionCommandPayload {
  const kinds = selectedConflictKinds(arguments_)
  const statuses = selectedConflictStatuses(arguments_)
  const projectPath = option(arguments_, 'project')
  return {
    contract: 'session-query-v2',
    request: {
      contractVersion: SESSION_QUERY_CONTRACT_VERSION,
      requestId: randomUUID(),
      query: {
        operation: 'delegations-conflicts',
        limit: option(arguments_, 'limit')
          ? positiveInteger(option(arguments_, 'limit'), '--limit')
          : SESSION_QUERY_DISCOVERY_LIMIT,
        ...(option(arguments_, 'cursor') ? { cursor: option(arguments_, 'cursor') } : {}),
        ...(hasFlag(arguments_, 'all')
          ? {}
          : projectPath
            ? { projectPath: resolveCliProjectPath(projectPath, workingDirectory) }
            : { workingPath: workingDirectory }),
        ...(option(arguments_, 'parent') ? { parentSessionId: option(arguments_, 'parent') } : {}),
        ...(option(arguments_, 'worker') ? { workerSessionId: option(arguments_, 'worker') } : {}),
        ...(option(arguments_, 'delegation')
          ? { delegationId: option(arguments_, 'delegation') }
          : {}),
        ...(kinds.length ? { kinds } : {}),
        ...(statuses.length ? { statuses } : {}),
      },
    },
  }
}

export function buildDelegationsCliPayload(
  command: string,
  arguments_: ParsedArguments,
  context: { readonly workingDirectory?: string } = {},
): LocalSessionCommandPayload {
  if (command === 'list') return listPayload(arguments_, context.workingDirectory ?? process.cwd())
  if (command === 'read') return readPayload(arguments_)
  if (command === 'conflicts') {
    return conflictsPayload(arguments_, context.workingDirectory ?? process.cwd())
  }
  if (DELEGATION_MUTATION_COMMANDS.has(command)) {
    return buildSessionsCliControlPayload('delegation', {
      ...arguments_,
      positionals: [command, ...arguments_.positionals],
    })
  }
  throw new Error(`Unsupported Delegations command: ${command}.`)
}
