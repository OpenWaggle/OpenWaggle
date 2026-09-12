import { randomUUID } from 'node:crypto'
import { matchBy } from '@diegogbrisa/ts-match'
import type * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionProfileManagementOutcome } from '@shared/types/local-session-profile-management'
import * as Effect from 'effect/Effect'
import { revokeAffectedRuns } from './sqlite-local-session-profile-revocation'
import {
  auditProfileChange,
  type ExecuteManagementInput,
  type ProfileRow,
  profileRepositoryError,
  profileSummary,
  rejectedProfileOutcome,
  selectProfiles,
} from './sqlite-local-session-profile-support'

function createProfile(
  sql: SqlClient.SqlClient,
  input: ExecuteManagementInput,
  command: Extract<ExecuteManagementInput['request']['command'], { operation: 'create' }>,
) {
  return Effect.gen(function* () {
    const existing = yield* selectProfiles(sql, command.name.trim())
    if (existing[0])
      return rejectedProfileOutcome(command.operation, 'profile_name_exists', command.name)
    if (!input.preparedCredential) {
      return rejectedProfileOutcome(command.operation, 'credential_required', command.name)
    }
    const profileId = randomUUID()
    yield* sql`
      INSERT INTO session_client_profiles (
        id, name, credential_verifier, capabilities_json, scope_json,
        authorization_ceiling, management_envelope_json, revoked_at,
        last_authenticated_at, created_at, updated_at
      ) VALUES (
        ${profileId}, ${command.name.trim()}, ${input.preparedCredential.verifier},
        ${JSON.stringify(command.capabilities)}, ${JSON.stringify(command.scope)},
        ${command.authorizationCeiling},
        ${command.managementEnvelope ? JSON.stringify(command.managementEnvelope) : null},
        ${null}, ${null}, ${input.now}, ${input.now}
      )
    `
    yield* auditProfileChange(sql, {
      profileId,
      action: 'created',
      actorCallerId: input.actorCallerId,
      now: input.now,
    })
    const created = yield* selectProfiles(sql, command.name.trim())
    if (!created[0])
      return yield* Effect.fail(profileRepositoryError('read-created-profile', command))
    return {
      operation: command.operation,
      effect: 'profile-created',
      profile: profileSummary(created[0]),
    } satisfies LocalSessionProfileManagementOutcome
  })
}

function persistUpdatedProfile(
  sql: SqlClient.SqlClient,
  input: ExecuteManagementInput,
  command: Extract<ExecuteManagementInput['request']['command'], { operation: 'update' }>,
  existing: ProfileRow,
) {
  return Effect.gen(function* () {
    yield* sql`
      UPDATE session_client_profiles SET
        capabilities_json = ${JSON.stringify(command.capabilities)},
        scope_json = ${JSON.stringify(command.scope)},
        authorization_ceiling = ${command.authorizationCeiling},
        management_envelope_json = ${
          command.managementEnvelope ? JSON.stringify(command.managementEnvelope) : null
        }, updated_at = ${input.now}
      WHERE id = ${existing.id}
    `
    yield* auditProfileChange(sql, {
      profileId: existing.id,
      action: 'updated',
      actorCallerId: input.actorCallerId,
      now: input.now,
    })
  })
}

function persistRotatedProfile(
  sql: SqlClient.SqlClient,
  input: ExecuteManagementInput,
  command: Extract<ExecuteManagementInput['request']['command'], { operation: 'rotate' }>,
  existing: ProfileRow,
) {
  if (!input.preparedCredential) {
    return Effect.succeed(
      rejectedProfileOutcome(command.operation, 'credential_required', command.profileName),
    )
  }
  return Effect.gen(function* () {
    yield* sql`
      UPDATE session_client_profiles
      SET credential_verifier = ${input.preparedCredential?.verifier}, updated_at = ${input.now}
      WHERE id = ${existing.id}
    `
    yield* auditProfileChange(sql, {
      profileId: existing.id,
      action: 'rotated',
      actorCallerId: input.actorCallerId,
      now: input.now,
    })
  })
}

function persistRevokedProfile(
  sql: SqlClient.SqlClient,
  input: ExecuteManagementInput,
  command: Extract<ExecuteManagementInput['request']['command'], { operation: 'revoke' }>,
  existing: ProfileRow,
) {
  return Effect.gen(function* () {
    const interruptedRuns =
      existing.revoked_at === null ? yield* revokeAffectedRuns(sql, existing.id, input.now) : []
    if (existing.revoked_at === null) {
      yield* sql`
        UPDATE session_client_profiles SET revoked_at = ${input.now}, updated_at = ${input.now}
        WHERE id = ${existing.id}
      `
      yield* auditProfileChange(sql, {
        profileId: existing.id,
        action: 'revoked',
        actorCallerId: input.actorCallerId,
        now: input.now,
      })
    }
    const revoked = yield* selectProfiles(sql, command.profileName)
    if (!revoked[0])
      return yield* Effect.fail(profileRepositoryError('read-revoked-profile', command))
    return {
      operation: command.operation,
      effect: 'profile-revoked',
      profile: profileSummary(revoked[0]),
      interruptedRuns,
    } satisfies LocalSessionProfileManagementOutcome
  })
}

function changedOutcome(
  command: Extract<
    ExecuteManagementInput['request']['command'],
    { operation: 'update' | 'rotate' }
  >,
  profile: ProfileRow,
): LocalSessionProfileManagementOutcome {
  return command.operation === 'update'
    ? { operation: command.operation, effect: 'profile-updated', profile: profileSummary(profile) }
    : { operation: command.operation, effect: 'profile-rotated', profile: profileSummary(profile) }
}

function changeProfile(
  sql: SqlClient.SqlClient,
  input: ExecuteManagementInput,
  command: Exclude<ExecuteManagementInput['request']['command'], { operation: 'list' | 'create' }>,
) {
  return Effect.gen(function* () {
    const existing = (yield* selectProfiles(sql, command.profileName))[0]
    if (!existing)
      return rejectedProfileOutcome(command.operation, 'profile_not_found', command.profileName)
    if (command.operation !== 'revoke' && existing.revoked_at !== null) {
      return rejectedProfileOutcome(command.operation, 'profile_revoked', command.profileName)
    }
    const immediate = yield* matchBy(command, 'operation')
      .with('update', (selected) => persistUpdatedProfile(sql, input, selected, existing))
      .with('rotate', (selected) => persistRotatedProfile(sql, input, selected, existing))
      .with('revoke', (selected) => persistRevokedProfile(sql, input, selected, existing))
      .exhaustive()
    if (immediate) return immediate
    if (command.operation === 'revoke') {
      return yield* Effect.fail(profileRepositoryError('revoke-profile-missing-outcome', command))
    }
    const updated = (yield* selectProfiles(sql, command.profileName))[0]
    if (!updated) return yield* Effect.fail(profileRepositoryError('read-updated-profile', command))
    return changedOutcome(command, updated)
  })
}

export function executeMutableProfileManagement(
  sql: SqlClient.SqlClient,
  input: ExecuteManagementInput,
) {
  const command = input.request.command
  if (command.operation === 'list') throw new Error('List is not a mutable profile operation.')
  return command.operation === 'create'
    ? createProfile(sql, input, command)
    : changeProfile(sql, input, command)
}
