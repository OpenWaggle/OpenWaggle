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
  type SessionsCliErrorKind,
  sessionsCliResponseText,
  writeSessionsCliError,
} from './sessions-cli-output'

export class AmbiguousProfileOperationError extends Error {
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
    error instanceof Error &&
    error.name === 'AmbiguousProfileOperationError' &&
    error.cause !== undefined
  ) {
    return classifyAccessCliError(error.cause)
  }
  return classifySessionsCliError(error)
}

/** The kind the Session Host gave a refused profile change (ADR 0063). */
export function accessCliRejectedOutcomeKind(
  outcome: Extract<LocalSessionProfileManagementOutcome, { readonly effect: 'rejected' }>,
): SessionsCliErrorKind {
  return outcome.kind
}

export function writeAccessCliError(
  error: unknown,
  json: boolean,
  stderr: (value: string) => void = process.stderr.write.bind(process.stderr),
) {
  return writeSessionsCliError(new AccessCliClassifiedError(error), json, stderr)
}

/** How many wrapped causes to look through for a Session Host code. */
const MAX_CAUSE_DEPTH = 8

/** The Session Host code of an error or of the error it wraps, as an uncertain create does. */
function hostRefusalCode(error: unknown): string | undefined {
  for (
    let current = error, depth = 0;
    current instanceof Error && depth < MAX_CAUSE_DEPTH;
    depth += 1
  ) {
    if (current instanceof CliError || current instanceof LocalSessionClientProtocolError) {
      if (current.code) return current.code
    }
    current = current.cause
  }
  return undefined
}

/** Carries the Access classification to the shared writer, which reads `kind` from a CliError. */
class AccessCliClassifiedError extends CliError {
  constructor(error: unknown) {
    const code = hostRefusalCode(error)
    super(classifyAccessCliError(error), formatErrorMessage(error), {
      cause: error,
      ...(code ? { code } : {}),
    })
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
  if (input.json) {
    return sessionsCliResponseText(`access profiles ${input.operation}`, response, true)
  }
  const destination = input.response.credentialDestination
  return `${[
    humanAccessOutcome(response.outcome),
    ...(destination ? [`Credential: ${destination.location}`] : []),
  ].join('\n')}\n`
}
