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

export function profileManagementRejectionReason(
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

export function profileManagementRejection(
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

export function profileManagementTargetName(command: LocalSessionProfileManagementCommand) {
  return command.operation === 'create'
    ? command.name
    : 'profileName' in command
      ? command.profileName
      : undefined
}

export function canManageLocalSessionProfiles(
  caller: LocalSessionCallerIdentity,
  required: readonly SessionCapability[] = ['access:profiles'],
) {
  return (
    caller.profileAuthority === undefined ||
    includesAll(caller.profileAuthority.capabilities, required)
  )
}
