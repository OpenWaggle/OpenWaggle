import type { LocalSessionProfileManagementOutcome } from '@shared/types/local-session-profile-management'
import { AcceptedProfileCredentialRecoveryError } from './access-cli-credential-settlement'
import { LocalSessionClientProtocolError } from './session-host/local-session-client-protocol-error'
import {
  classifySessionsCliError,
  SESSIONS_CLI_OUTPUT_SCHEMA_VERSION,
  type SessionsCliErrorKind,
} from './sessions-cli-output'

export const ACCESS_CLI_OUTPUT_SCHEMA_VERSION = SESSIONS_CLI_OUTPUT_SCHEMA_VERSION

export function classifyAccessCliError(error: unknown): SessionsCliErrorKind {
  if (error instanceof AcceptedProfileCredentialRecoveryError) return 'internal'
  if (
    error instanceof LocalSessionClientProtocolError &&
    (error.code === 'authentication_failed' || error.code === 'credential_rejected')
  ) {
    return 'authentication'
  }
  if (
    error instanceof Error &&
    error.name === 'AmbiguousProfileOperationError' &&
    error.cause !== undefined
  ) {
    return classifyAccessCliError(error.cause)
  }
  return classifySessionsCliError(error)
}

export function accessCliRejectedOutcomeKind(
  outcome: Extract<LocalSessionProfileManagementOutcome, { readonly effect: 'rejected' }>,
): SessionsCliErrorKind {
  if (outcome.code === 'profile_not_found') return 'not_found'
  if (
    outcome.code === 'missing_access_profiles' ||
    outcome.code === 'profile_credential_control_requires_local_user' ||
    outcome.code === 'cannot_edit_own_policy' ||
    outcome.code === 'management_envelope_missing' ||
    outcome.code === 'management_envelope_exceeded' ||
    outcome.code === 'profile_redelegation_requires_local_user'
  ) {
    return 'authorization'
  }
  if (outcome.code === 'credential_required') return 'authentication'
  return 'conflict'
}

export function writeAccessCliError(
  error: unknown,
  json: boolean,
  stderr: (value: string) => void = process.stderr.write.bind(process.stderr),
) {
  const kind = classifyAccessCliError(error)
  const message = error instanceof Error ? error.message : String(error)
  const output = json
    ? JSON.stringify({
        schemaVersion: ACCESS_CLI_OUTPUT_SCHEMA_VERSION,
        type: 'error',
        error: { kind, message },
      })
    : `error [${kind}]: ${message}`
  stderr(`${output}\n`)
  return kind
}
