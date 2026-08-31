import * as SqlClient from '@effect/sql/SqlClient'
import { canonicalJson } from '@shared/canonical-json'
import { parseJsonUnknown } from '@shared/schema'
import { decodeLocalSessionProfileManagementOutcome } from '@shared/schemas/local-session-profile-management'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { LocalSessionProfileRepositoryError } from '../errors'
import {
  LocalSessionProfileRepository,
  type LocalSessionProfileRepositoryShape,
} from '../ports/local-session-profile-repository'

interface OperationRow {
  readonly request_json: string
  readonly outcome_json: string | null
}

import { executeMutableProfileManagement } from './sqlite-local-session-profile-mutations'
import {
  decodeProfile,
  type ExecuteManagementInput,
  type ProfileRow,
  profileSummary,
  profileRepositoryError as repositoryError,
  selectProfiles,
} from './sqlite-local-session-profile-support'

function selectProfileById(sql: SqlClient.SqlClient, id: string) {
  return sql<ProfileRow>`SELECT * FROM session_client_profiles WHERE id = ${id} LIMIT 1`
}

function list(sql: SqlClient.SqlClient) {
  return selectProfiles(sql).pipe(
    Effect.flatMap((rows) =>
      Effect.try({
        try: () => rows.map(profileSummary),
        catch: (cause) => repositoryError('decode-profile-list', cause),
      }),
    ),
    Effect.mapError((cause) =>
      cause instanceof LocalSessionProfileRepositoryError
        ? cause
        : repositoryError('list-profiles', cause),
    ),
  )
}

function authenticationRecord(row: ProfileRow) {
  const profile = decodeProfile(row)
  return {
    id: profile.id,
    name: profile.name,
    credentialVerifier: profile.credentialVerifier,
    capabilities: profile.capabilities,
    scope: profile.scope,
    authorizationCeiling: profile.authorizationCeiling,
    ...(profile.managementEnvelope ? { managementEnvelope: profile.managementEnvelope } : {}),
    revokedAt: profile.revokedAt,
  }
}

function findProfile(operation: string, rows: Effect.Effect<readonly ProfileRow[], unknown>) {
  return Effect.gen(function* () {
    const selected = yield* rows
    if (!selected[0]) return null
    return yield* Effect.try({
      try: () => authenticationRecord(selected[0]),
      catch: (cause) => repositoryError('decode-profile', cause),
    })
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof LocalSessionProfileRepositoryError
        ? cause
        : repositoryError(operation, cause),
    ),
  )
}

function findForAuthentication(sql: SqlClient.SqlClient, name: string) {
  return findProfile('find-for-authentication', selectProfiles(sql, name))
}

function findById(sql: SqlClient.SqlClient, id: string) {
  return findProfile('find-profile-by-id', selectProfileById(sql, id))
}

function recordAuthentication(
  sql: SqlClient.SqlClient,
  input: Parameters<LocalSessionProfileRepositoryShape['recordAuthentication']>[0],
) {
  return sql
    .withTransaction(
      Effect.gen(function* () {
        if (input.accepted) {
          yield* sql`
            UPDATE session_client_profiles
            SET last_authenticated_at = ${input.now}, updated_at = ${input.now}
            WHERE id = ${input.profileId}
          `
        }
        yield* sql`
          INSERT INTO session_client_profile_audit (
            profile_id, action, actor_caller_id, detail_json, created_at
          ) VALUES (
            ${input.profileId},
            ${input.accepted ? 'authenticated' : 'authentication_failed'},
            ${`profile:${input.profileId}`},
            ${JSON.stringify({
              clientKind: input.clientKind,
              clientVersion: input.clientVersion,
            })},
            ${input.now}
          )
        `
      }),
    )
    .pipe(Effect.mapError((cause) => repositoryError('record-authentication', cause)))
}

function operationName(command: ExecuteManagementInput['request']['command']) {
  return command.operation === 'create'
    ? command.name
    : 'profileName' in command
      ? command.profileName
      : 'catalog'
}

function journalRequest(input: ExecuteManagementInput) {
  const command = input.request.command
  if (command.operation !== 'create' && command.operation !== 'rotate') return command
  if (!input.preparedCredential) throw new Error('Prepared profile credential is required.')
  const { credential: _credential, ...rest } = command
  return { ...rest, credentialFingerprint: input.preparedCredential.fingerprint }
}

function executeManagement(sql: SqlClient.SqlClient, input: ExecuteManagementInput) {
  const command = input.request.command
  if (command.operation === 'list') {
    return list(sql).pipe(
      Effect.map((profiles) => ({
        operation: command.operation,
        effect: 'profiles-listed' as const,
        profiles,
      })),
      Effect.map((outcome) => ({
        contractVersion: input.request.contractVersion,
        requestId: input.request.requestId,
        idempotencyKey: input.request.idempotencyKey,
        replayed: false,
        outcome,
      })),
      Effect.mapError((cause) =>
        cause instanceof LocalSessionProfileRepositoryError
          ? cause
          : repositoryError('execute-profile-list', cause),
      ),
    )
  }
  const operation = command.operation
  const targetScope = `profile:${operationName(command)}`
  const requestJson = canonicalJson(journalRequest(input))
  return sql
    .withTransaction(
      Effect.gen(function* () {
        const replayRows = yield* sql<OperationRow>`
          SELECT request_json, outcome_json FROM session_operations
          WHERE caller_id = ${input.actorCallerId} AND operation = ${`access:${operation}`}
            AND target_scope = ${targetScope}
            AND idempotency_key = ${input.request.idempotencyKey}
          LIMIT 1
        `
        const replay = replayRows[0]
        if (replay) {
          if (replay.request_json !== requestJson || !replay.outcome_json) {
            return yield* Effect.fail(repositoryError('profile-idempotency-key-reused', operation))
          }
          return {
            replayed: true,
            outcome: decodeLocalSessionProfileManagementOutcome(
              parseJsonUnknown(replay.outcome_json),
            ),
          }
        }
        const outcome = yield* executeMutableProfileManagement(sql, input)
        yield* sql`
          INSERT INTO session_operations (
            caller_id, operation, target_scope, idempotency_key, request_json,
            status, outcome_json, created_at, updated_at
          ) VALUES (
            ${input.actorCallerId}, ${`access:${operation}`}, ${targetScope},
            ${input.request.idempotencyKey}, ${requestJson}, ${'completed'},
            ${JSON.stringify(outcome)}, ${input.now}, ${input.now}
          )
        `
        return { replayed: false, outcome }
      }),
    )
    .pipe(
      Effect.map(({ replayed, outcome }) => ({
        contractVersion: input.request.contractVersion,
        requestId: input.request.requestId,
        idempotencyKey: input.request.idempotencyKey,
        replayed,
        outcome,
      })),
      Effect.mapError((cause) =>
        cause instanceof LocalSessionProfileRepositoryError
          ? cause
          : repositoryError('execute-profile-management', cause),
      ),
    )
}

export const SqliteLocalSessionProfileRepositoryLive = Layer.effect(
  LocalSessionProfileRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return LocalSessionProfileRepository.of({
      list: () => list(sql),
      findForAuthentication: (name) => findForAuthentication(sql, name),
      findById: (id) => findById(sql, id),
      recordAuthentication: (input) => recordAuthentication(sql, input),
      executeManagement: (input) => executeManagement(sql, input),
    })
  }),
)
