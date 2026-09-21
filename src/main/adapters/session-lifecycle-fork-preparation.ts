import type * as SqlClient from '@effect/sql/SqlClient'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import type { ForkSessionCommand } from '@shared/types/session-lifecycle'
import * as Effect from 'effect/Effect'
import { reserveSessionTreeMutation } from '../application/active-session-runs'
import { SessionLifecyclePreparationError } from '../errors'
import type { AgentKernelServiceShape } from '../ports/agent-kernel-service'

interface ForkSourceRow {
  readonly id: string
  readonly title: string
  readonly project_path: string | null
  readonly pi_session_id: string
  readonly pi_session_file: string | null
  readonly archived: number
  readonly created_at: number
  readonly updated_at: number
  readonly environment_mode: 'local' | 'worktree' | null
  readonly worktree_path: string | null
  readonly worktree_base_ref: string | null
  readonly worktree_start_from_origin: number
  readonly authorization_mode_override: 'yolo' | 'ask-for-approval' | null
  readonly last_active_node_id: string | null
}

function forkError(operation: string, cause: unknown) {
  return new SessionLifecyclePreparationError({ operation, cause })
}

function sourceDetail(row: ForkSourceRow, command: ForkSessionCommand): SessionDetail {
  return {
    id: SessionId(command.sourceSessionId),
    title: row.title,
    projectPath: row.project_path,
    piSessionId: row.pi_session_id,
    ...(row.pi_session_file ? { piSessionFile: row.pi_session_file } : {}),
    messages: [],
    archived: row.archived === 1 ? true : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    environmentMode: row.environment_mode ?? 'local',
    worktreePath: row.worktree_path,
    worktreeBaseRef: row.worktree_base_ref,
    worktreeStartFromOrigin: row.worktree_start_from_origin === 1,
    ...(row.authorization_mode_override
      ? { authorizationMode: row.authorization_mode_override }
      : {}),
  }
}

export function prepareLifecycleFork(input: {
  readonly sql: SqlClient.SqlClient
  readonly kernel: AgentKernelServiceShape
  readonly command: ForkSessionCommand
  readonly modelId: string
}) {
  return Effect.gen(function* () {
    const writer = yield* Effect.sync(() =>
      reserveSessionTreeMutation(SessionId(input.command.sourceSessionId)),
    )
    return yield* Effect.gen(function* () {
      const rows = yield* input.sql<ForkSourceRow>`
      SELECT
        id, title, project_path, pi_session_id, pi_session_file, archived,
        created_at, updated_at, environment_mode, worktree_path,
        worktree_base_ref, worktree_start_from_origin,
        authorization_mode_override, last_active_node_id
      FROM sessions WHERE id = ${input.command.sourceSessionId} LIMIT 1
    `
      const row = rows[0]
      if (!row) {
        return yield* Effect.fail(
          forkError('fork-source-not-found', { sourceSessionId: input.command.sourceSessionId }),
        )
      }
      const targetNodeId = input.command.targetNodeId ?? row.last_active_node_id
      if (!targetNodeId) {
        return yield* Effect.fail(
          forkError('fork-source-has-no-history', {
            sourceSessionId: input.command.sourceSessionId,
          }),
        )
      }
      const result = yield* input.kernel.forkSession({
        session: sourceDetail(row, input.command),
        model: SupportedModelId(input.modelId),
        targetNodeId,
        position: input.command.position ?? 'at',
      })
      if (result.cancelled) {
        return yield* Effect.fail(
          forkError('fork-cancelled', {
            sourceSessionId: input.command.sourceSessionId,
            targetNodeId,
          }),
        )
      }
      return { result, targetNodeId }
    }).pipe(Effect.ensuring(Effect.sync(writer.release)))
  })
}
