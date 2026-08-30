import { createHash } from 'node:crypto'
import type {
  LocalSessionCallerIdentity,
  LocalSessionProfileManagementEnvelope,
  LocalSessionProfileScope,
} from '@shared/types/local-session-profile'
import {
  LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION,
  type LocalSessionProfileManagementCommand,
  type LocalSessionProfileManagementOutcome,
  type LocalSessionProfileManagementRequest,
} from '@shared/types/local-session-profile-management'
import type { SessionCapability } from '@shared/types/session-capability'
import * as Effect from 'effect/Effect'
import { AgentRunInterruptionService } from '../ports/agent-run-interruption-service'
import { LocalSessionProfileRepository } from '../ports/local-session-profile-repository'
import { createProfileCredentialVerifier } from '../session-host/profile-credential'
import { canonicalizeExistingDirectoryRoots } from '../utils/canonical-directory-roots'

function isLocalUser(caller: LocalSessionCallerIdentity) {
  return caller.profileAuthority === undefined
}

function includesAll<T>(available: readonly T[], requested: readonly T[]) {
  return requested.every((value) => available.includes(value))
}

function arraySubset(
  available: readonly string[] | undefined,
  requested: readonly string[] | undefined,
) {
  if (!requested || requested.length === 0) return true
  if (!available) return false
  return includesAll(available, requested)
}

function scopeSubset(available: LocalSessionProfileScope, requested: LocalSessionProfileScope) {
  if (!arraySubset(available.workspaceRoots, requested.workspaceRoots)) return false
  if (!arraySubset(available.attachmentRoots, requested.attachmentRoots)) return false
  if (!arraySubset(available.exportRoots, requested.exportRoots)) return false
  if (available.all) return true
  if (requested.all) return false
  return (
    arraySubset(available.projectPaths, requested.projectPaths) &&
    arraySubset(available.sessionIds, requested.sessionIds) &&
    arraySubset(available.hiveRootSessionIds, requested.hiveRootSessionIds)
  )
}

function policySubset(
  envelope: LocalSessionProfileManagementEnvelope,
  command: Extract<LocalSessionProfileManagementCommand, { operation: 'create' | 'update' }>,
) {
  return (
    includesAll(envelope.capabilities, command.capabilities) &&
    scopeSubset(envelope.scope, command.scope) &&
    (envelope.authorizationCeiling === 'yolo' ||
      command.authorizationCeiling === 'ask-for-approval')
  )
}

function rejectsNamedAdministration(
  caller: LocalSessionCallerIdentity,
  command: LocalSessionProfileManagementCommand,
) {
  const authority = caller.profileAuthority
  if (!authority) return undefined
  const ownsTarget = 'profileName' in command && command.profileName === authority.profileName
  if (command.operation === 'rotate' || command.operation === 'revoke') {
    return ownsTarget ? undefined : 'profile_credential_control_requires_local_user'
  }
  if (!authority.capabilities.includes('access:profiles')) return 'missing_access_profiles'
  if (command.operation === 'list') return undefined
  if (ownsTarget) return 'cannot_edit_own_policy'
  if (!authority.managementEnvelope) return 'management_envelope_missing'
  if (command.capabilities.includes('access:profiles') || command.managementEnvelope) {
    return 'profile_redelegation_requires_local_user'
  }
  return policySubset(authority.managementEnvelope, command)
    ? undefined
    : 'management_envelope_exceeded'
}

function rejection(
  request: LocalSessionProfileManagementRequest,
  code: string,
  profileName?: string,
) {
  const outcome: LocalSessionProfileManagementOutcome = {
    operation: request.command.operation,
    effect: 'rejected',
    code,
    ...(profileName ? { profileName } : {}),
  }
  return {
    contractVersion: LOCAL_SESSION_PROFILE_MANAGEMENT_CONTRACT_VERSION,
    requestId: request.requestId,
    idempotencyKey: request.idempotencyKey,
    replayed: false,
    outcome,
  }
}

function profileName(command: LocalSessionProfileManagementCommand) {
  return command.operation === 'create'
    ? command.name
    : 'profileName' in command
      ? command.profileName
      : undefined
}

function prepareCredential(command: LocalSessionProfileManagementCommand) {
  if (command.operation !== 'create' && command.operation !== 'rotate')
    return Effect.succeed(undefined)
  return Effect.tryPromise({
    try: async () => ({
      verifier: await createProfileCredentialVerifier(command.credential),
      fingerprint: createHash('sha256').update(command.credential).digest('base64url'),
    }),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })
}

function canonicalizeProfileScope(scope: LocalSessionProfileScope) {
  return Effect.tryPromise({
    try: async () => ({
      ...scope,
      ...(scope.projectPaths
        ? {
            projectPaths: await canonicalizeExistingDirectoryRoots(
              scope.projectPaths,
              'Profile project root',
            ),
          }
        : {}),
      ...(scope.workspaceRoots
        ? {
            workspaceRoots: await canonicalizeExistingDirectoryRoots(
              scope.workspaceRoots,
              'Profile workspace root',
            ),
          }
        : {}),
      ...(scope.exportRoots
        ? {
            exportRoots: await canonicalizeExistingDirectoryRoots(
              scope.exportRoots,
              'Profile export root',
            ),
          }
        : {}),
      ...(scope.attachmentRoots
        ? {
            attachmentRoots: await canonicalizeExistingDirectoryRoots(
              scope.attachmentRoots,
              'Profile attachment root',
            ),
          }
        : {}),
    }),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })
}

function canonicalizeProfilePolicyCommand(command: LocalSessionProfileManagementCommand) {
  if (command.operation !== 'create' && command.operation !== 'update') {
    return Effect.succeed(command)
  }
  return Effect.gen(function* () {
    const scope = yield* canonicalizeProfileScope(command.scope)
    const managementEnvelope = command.managementEnvelope
      ? {
          ...command.managementEnvelope,
          scope: yield* canonicalizeProfileScope(command.managementEnvelope.scope),
        }
      : undefined
    return {
      ...command,
      scope,
      ...(managementEnvelope ? { managementEnvelope } : {}),
    } satisfies LocalSessionProfileManagementCommand
  })
}

function interruptRevokedRuns(outcome: LocalSessionProfileManagementOutcome, replayed: boolean) {
  if (replayed || outcome.effect !== 'profile-revoked') return Effect.void
  return Effect.gen(function* () {
    const interruption = yield* AgentRunInterruptionService
    yield* Effect.forEach(outcome.interruptedRuns, (run) => interruption.interrupt(run), {
      concurrency: 'unbounded',
      discard: true,
    })
  })
}

export function manageLocalSessionProfiles(input: {
  readonly caller: LocalSessionCallerIdentity
  readonly request: LocalSessionProfileManagementRequest
  readonly now: number
}) {
  return Effect.gen(function* () {
    const command = yield* canonicalizeProfilePolicyCommand(input.request.command)
    const request = { ...input.request, command }
    const reason = rejectsNamedAdministration(input.caller, command)
    if (reason) return rejection(request, reason, profileName(command))
    const repository = yield* LocalSessionProfileRepository
    const preparedCredential = yield* prepareCredential(command)
    const response = yield* repository.executeManagement({
      actorCallerId: input.caller.callerId,
      request,
      ...(preparedCredential ? { preparedCredential } : {}),
      now: input.now,
    })
    yield* interruptRevokedRuns(response.outcome, response.replayed)
    return response
  })
}

export function canManageLocalSessionProfiles(
  caller: LocalSessionCallerIdentity,
  required: readonly SessionCapability[] = ['access:profiles'],
) {
  return isLocalUser(caller) || includesAll(caller.profileAuthority?.capabilities ?? [], required)
}
