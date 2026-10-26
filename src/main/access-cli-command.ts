import { randomUUID } from 'node:crypto'
import {
  LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION,
  type LocalSessionProfileManagementCommand,
} from '@shared/types/local-session-profile-management'
import { parseProfilePolicy } from './access-cli-policy'
import { CommandCliUsageError } from './command-cli-option-contract'
import { hasFlag, option, type parseMcpCliArguments } from './mcp-cli-arguments'
import type { ProfileCredentialDestination } from './session-host/profile-credential-destination'

/** The `access profiles` command lines as profile-management requests. */
export function required(value: string | undefined, label: string) {
  if (!value) throw new CommandCliUsageError(`${label} is required.`)
  return value
}

export function destination(
  arguments_: ReturnType<typeof parseMcpCliArguments>,
  stateRoot: string,
): ProfileCredentialDestination {
  const store = hasFlag(arguments_, 'credential-store')
  const file = option(arguments_, 'credential-file')
  if (store === Boolean(file)) {
    throw new CommandCliUsageError(
      'Choose exactly one --credential-store or --credential-file <path>.',
    )
  }
  return store
    ? { kind: 'credential-store', stateRoot }
    : { kind: 'file', path: required(file, '--credential-file') }
}

export function request(command: LocalSessionProfileManagementCommand, idempotencyKey: string) {
  return {
    contractVersion: LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION,
    requestId: randomUUID(),
    idempotencyKey,
    command,
  }
}

export function buildCommand(
  operation: string,
  arguments_: ReturnType<typeof parseMcpCliArguments>,
  credential?: string,
): LocalSessionProfileManagementCommand {
  if (operation === 'list') return { operation }
  const profileName = required(arguments_.positionals[0], 'Profile name')
  if (operation === 'create') {
    return {
      operation,
      name: profileName,
      credential: required(credential, 'Credential'),
      ...parseProfilePolicy(arguments_),
    }
  }
  if (operation === 'update') return { operation, profileName, ...parseProfilePolicy(arguments_) }
  if (operation === 'rotate') {
    return { operation, profileName, credential: required(credential, 'Credential') }
  }
  if (operation === 'revoke') return { operation, profileName }
  throw new CommandCliUsageError(`Unsupported profile operation: ${operation}.`)
}
