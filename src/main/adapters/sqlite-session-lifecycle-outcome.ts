import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { SessionLifecycleRepositoryError } from '../errors'
import type { SessionLifecycleRepositoryShape } from '../ports/session-lifecycle-repository'

type ExecuteInput = Parameters<SessionLifecycleRepositoryShape['execute']>[0]

export interface ResolvedLifecycleOutcomeInput {
  readonly workspaceId: string
  readonly authorityOriginCallerId: string
  readonly runId?: string
  readonly parentSessionId?: string
  readonly parentRunId?: string
  readonly hiveRootSessionId?: string
  readonly depth?: number
}

interface SpawnOutcomeIdentities {
  readonly authorityOriginCallerId: string
  readonly runId: string
  readonly parentSessionId: string
  readonly parentRunId: string
  readonly hiveRootSessionId: string
  readonly depth: number
  readonly delegationId: string
  readonly derivedGrantId: string
}

function outcomeError(operation: string, cause: unknown) {
  return new SessionLifecycleRepositoryError({ operation, cause })
}

function requireSpawnOutcome(input: ExecuteInput, resolved: ResolvedLifecycleOutcomeInput) {
  const complete =
    resolved.runId &&
    resolved.parentSessionId &&
    resolved.parentRunId &&
    resolved.hiveRootSessionId &&
    resolved.depth !== undefined &&
    input.delegationId &&
    input.derivedGrantId
  return complete
    ? Effect.succeed<SpawnOutcomeIdentities>({
        authorityOriginCallerId: resolved.authorityOriginCallerId,
        runId: resolved.runId,
        parentSessionId: resolved.parentSessionId,
        parentRunId: resolved.parentRunId,
        hiveRootSessionId: resolved.hiveRootSessionId,
        depth: resolved.depth,
        delegationId: input.delegationId,
        derivedGrantId: input.derivedGrantId,
      })
    : Effect.fail(outcomeError('spawn-outcome-identities-required', { resolved }))
}

function persistSpawnFacts(
  sql: SqlClient.SqlClient,
  input: ExecuteInput,
  resolved: SpawnOutcomeIdentities,
) {
  const delegation =
    input.request.command.operation === 'spawn' ? input.request.command.delegation : undefined
  if (!delegation) return Effect.fail(outcomeError('spawn-command-required', input.request.command))
  return Effect.gen(function* () {
    yield* sql`
      INSERT INTO session_spawn_lineage (
        child_session_id, parent_session_id, parent_run_id,
        hive_root_session_id, depth, created_at
      ) VALUES (
        ${input.session.sessionId}, ${resolved.parentSessionId}, ${resolved.parentRunId},
        ${resolved.hiveRootSessionId}, ${resolved.depth}, ${input.now}
      )
    `
    yield* sql`
      INSERT INTO delegation_contracts (
        id, parent_session_id, child_session_id, state,
        current_specification_revision, created_at, updated_at
      ) VALUES (
        ${resolved.delegationId}, ${resolved.parentSessionId}, ${input.session.sessionId},
        ${'working'}, ${1}, ${input.now}, ${input.now}
      )
    `
    yield* sql`
      INSERT INTO delegation_specifications (
        delegation_id, revision, specification_json, authored_by, created_at
      ) VALUES (
        ${resolved.delegationId}, ${1}, ${JSON.stringify(delegation)},
        ${input.callerId}, ${input.now}
      )
    `
    for (const dependency of delegation.dependencies) {
      yield* sql`
        INSERT INTO delegation_dependencies (
          delegation_id, dependency_delegation_id, required_state, created_at
        ) VALUES (
          ${resolved.delegationId}, ${dependency.delegationId},
          ${dependency.requiredState}, ${input.now}
        )
      `
    }
    yield* sql`
      INSERT INTO derived_child_management_grants (
        id, parent_session_id, child_session_id, delegation_id,
        source_caller_id, capabilities_json, authorization_ceiling, created_at
      ) VALUES (
        ${resolved.derivedGrantId}, ${resolved.parentSessionId}, ${input.session.sessionId},
        ${resolved.delegationId}, ${resolved.authorityOriginCallerId},
        ${JSON.stringify(input.derivedCapabilities ?? [])},
        ${input.executionSnapshot.authorizationCeiling}, ${input.now}
      )
    `
  })
}

export function lifecycleOutcome(
  sql: SqlClient.SqlClient,
  input: ExecuteInput,
  resolved: ResolvedLifecycleOutcomeInput,
) {
  const command = input.request.command
  if (command.operation === 'create') {
    return Effect.succeed({
      operation: 'create',
      effect: 'created-root',
      sessionId: input.session.sessionId,
      workspaceId: resolved.workspaceId,
    } as const)
  }
  if (command.operation === 'fork') {
    if (!resolved.parentSessionId || !input.forkSourceNodeId) {
      return Effect.fail(outcomeError('fork-outcome-source-required', { resolved }))
    }
    const sourceSessionId = resolved.parentSessionId
    const sourceNodeId = input.forkSourceNodeId
    const position = command.position ?? 'at'
    return sql`
      INSERT INTO session_derivations (
        derived_session_id, source_session_id, source_node_id, position, created_at
      ) VALUES (
        ${input.session.sessionId}, ${sourceSessionId}, ${sourceNodeId}, ${position}, ${input.now}
      )
    `.pipe(
      Effect.as({
        operation: 'fork',
        effect: 'forked-session',
        sessionId: input.session.sessionId,
        sourceSessionId,
        sourceNodeId,
        position,
        workspaceId: resolved.workspaceId,
        ...(input.forkEditorText ? { editorText: input.forkEditorText } : {}),
      } as const),
    )
  }
  if (command.operation === 'launch') {
    return resolved.runId
      ? Effect.succeed({
          operation: 'launch',
          effect: 'launched-root',
          sessionId: input.session.sessionId,
          runId: resolved.runId,
          workspaceId: resolved.workspaceId,
        } as const)
      : Effect.fail(outcomeError('launch-outcome-run-required', { resolved }))
  }
  return Effect.gen(function* () {
    const spawn = yield* requireSpawnOutcome(input, resolved)
    yield* persistSpawnFacts(sql, input, spawn)
    return {
      operation: 'spawn',
      effect: 'spawned-worker',
      sessionId: input.session.sessionId,
      runId: spawn.runId,
      workspaceId: resolved.workspaceId,
      parentSessionId: spawn.parentSessionId,
      parentRunId: spawn.parentRunId,
      hiveRootSessionId: spawn.hiveRootSessionId,
      depth: spawn.depth,
      delegationId: spawn.delegationId,
      derivedGrantId: spawn.derivedGrantId,
    } as const
  })
}
