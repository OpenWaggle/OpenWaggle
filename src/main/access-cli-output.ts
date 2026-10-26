import { matchBy } from '@diegogbrisa/ts-match'
import type {
  LocalSessionProfileManagementOutcome,
  LocalSessionProfileManagementResponse,
  LocalSessionProfileSummary,
} from '@shared/types/local-session-profile-management'
import { formatErrorMessage } from '@shared/utils/node-error'
import { AcceptedProfileCredentialRecoveryError } from './access-cli-credential-settlement'
import { CliError } from './cli-error'
import { LocalSessionClientProtocolError } from './session-host/local-session-client-protocol-error'
import {
  classifySessionsCliError,
  SESSIONS_CLI_OUTPUT_SCHEMA_VERSION,
  type SessionsCliErrorKind,
  sessionsCliResponseText,
  writeSessionsCliError,
} from './sessions-cli-output'

export const ACCESS_CLI_OUTPUT_SCHEMA_VERSION = SESSIONS_CLI_OUTPUT_SCHEMA_VERSION

export class AmbiguousProfileOperationError extends Error {
  readonly preserveStagedCredential = true

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AmbiguousProfileOperationError'
  }
}

export function preservedProfileCredentialError(error: unknown, recoveryLocation: string) {
  return new AmbiguousProfileOperationError(
    `${formatErrorMessage(error)} A previously staged credential remains protected at ${recoveryLocation}; verify its prior operation before removing it.`,
    { cause: error },
  )
}

export function writeAccessCliCleanupError(error: unknown, cleanupError: unknown, json: boolean) {
  return writeAccessCliError(
    new AggregateError(
      [error, cleanupError],
      `${formatErrorMessage(error)} Staged credential cleanup also failed: ${formatErrorMessage(cleanupError)}`,
    ),
    json,
  )
}

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
  return writeSessionsCliError(new AccessCliClassifiedError(error), json, stderr)
}

/** Carries the Access classification to the shared writer, which reads `kind` from a CliError. */
class AccessCliClassifiedError extends CliError {
  constructor(error: unknown) {
    super(classifyAccessCliError(error), formatErrorMessage(error), { cause: error })
  }
}

type ProfileSummary = LocalSessionProfileSummary

function scopeText(scope: ProfileSummary['scope']) {
  if (scope.all) return 'all Sessions'
  return [
    ...(scope.projectPaths ?? []).map((projectPath) => `project ${projectPath}`),
    ...(scope.sessionIds ?? []).map((sessionId) => `Session ${sessionId}`),
    ...(scope.hiveRootSessionIds ?? []).map((sessionId) => `hive ${sessionId}`),
  ].join(', ')
}

function profileLine(profile: ProfileSummary) {
  return [
    profile.name,
    profile.revokedAt === null ? 'active' : 'revoked',
    profile.capabilities.join(','),
    scopeText(profile.scope),
    profile.authorizationCeiling,
  ].join('\t')
}

function humanAccessOutcome(outcome: LocalSessionProfileManagementOutcome) {
  return matchBy(outcome, 'effect')
    .with('profiles-listed', (listed) =>
      listed.profiles.length === 0
        ? 'No access profiles.'
        : listed.profiles.map(profileLine).join('\n'),
    )
    .with('profile-created', (created) => `Created access profile ${created.profile.name}.`)
    .with('profile-updated', (updated) => `Updated access profile ${updated.profile.name}.`)
    .with('profile-rotated', (rotated) => `Rotated the credential of ${rotated.profile.name}.`)
    .with('profile-revoked', (revoked) =>
      [
        `Revoked access profile ${revoked.profile.name}.`,
        ...revoked.interruptedRuns.map(
          (run) => `Interrupted Run ${run.runId} of ${run.sessionId}.`,
        ),
      ].join('\n'),
    )
    .with(
      'rejected',
      (rejected) =>
        `Refused (${rejected.code})${rejected.profileName ? `: ${rejected.profileName}` : ''}.`,
    )
    .exhaustive()
}

/**
 * `access profiles` output: the Hive CLI envelope with `--json` (#351), and readable lines
 * otherwise. `list` leaves out revoked profiles unless `--include-revoked` asks for them.
 */
export function accessCliResponseText(input: {
  readonly operation: string
  readonly response: LocalSessionProfileManagementResponse & {
    readonly credentialDestination?: { readonly kind: string; readonly location: string }
  }
  readonly json: boolean
  readonly includeRevoked: boolean
}) {
  const outcome = input.response.outcome
  const response =
    outcome.effect === 'profiles-listed' && !input.includeRevoked
      ? {
          ...input.response,
          outcome: {
            ...outcome,
            profiles: outcome.profiles.filter((profile) => profile.revokedAt === null),
          },
        }
      : input.response
  if (input.json)
    return sessionsCliResponseText(`access profiles ${input.operation}`, response, true)
  const destination = input.response.credentialDestination
  return `${[
    humanAccessOutcome(response.outcome),
    ...(destination ? [`Credential: ${destination.location}`] : []),
  ].join('\n')}\n`
}
