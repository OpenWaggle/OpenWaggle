import type * as SqlClient from '@effect/sql/SqlClient'
import { SessionId, SessionNodeId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import type { ForkSessionCommand } from '@shared/types/session-lifecycle'
import * as Effect from 'effect/Effect'
import { reserveSessionTreeMutation } from '../application/active-session-runs'
import { attributeCopiedVisualizationSources } from '../application/inline-visualization-ownership'
import { SessionLifecyclePreparationError } from '../errors'
import type { AgentKernelServiceShape } from '../ports/agent-kernel-service'
import { discoveredPiEntryNodeIdPrefix } from '../store/session-details/discovered-pi-entry-node-ids'

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
  readonly pi_adopted: number
  readonly pi_cwd: string | null
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
    // A discovered Pi session keys its nodes under a prefix and runs in its own folder (ADR 0051);
    // without them the fork target would reach Pi still prefixed.
    ...(row.pi_adopted === 1
      ? { piEntryNodeIdPrefix: discoveredPiEntryNodeIdPrefix(command.sourceSessionId) }
      : {}),
    ...(row.pi_cwd ? { piSessionCwd: row.pi_cwd } : {}),
  }
}

/** Names the Pi file a preparation attempt made, so a failed or interrupted one is cleaned up. */
export function recordPreparedSessionFile(
  sql: SqlClient.SqlClient,
  attemptId: string,
  piSessionFile: string | undefined,
) {
  return sql`
    UPDATE session_lifecycle_preparation_attempts
    SET pi_session_file = ${piSessionFile ?? null}, updated_at = ${Date.now()}
    WHERE attempt_id = ${attemptId}
  `
}

/** The desktop app's caller; it clones a Session as a fork that keeps the target. */
const DESKTOP_APP_CALLER_ID = 'gui:local-user'

export function prepareLifecycleFork(input: {
  readonly sql: SqlClient.SqlClient
  readonly kernel: AgentKernelServiceShape
  readonly command: ForkSessionCommand
  /** Who asked: only the desktop app's clone is a clone; the CLI and Sessions tool fork. */
  readonly callerId: string
  readonly modelId: string
  /** The preparation attempt the fork's file is recorded under before it is written. */
  readonly attemptId: string
  /** Told the fork's file once it is recorded, so a failed preparation removes it. */
  readonly onForkFile: (piSessionFile: string) => void
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
        authorization_mode_override, last_active_node_id,
        EXISTS (SELECT 1 FROM pi_session_adoptions WHERE session_id = sessions.id) AS pi_adopted,
        (SELECT cwd FROM pi_session_adoptions WHERE session_id = sessions.id) AS pi_cwd
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
        copy:
          input.callerId === DESKTOP_APP_CALLER_ID && input.command.position === 'at'
            ? 'clone'
            : 'fork',
        // OpenWaggle names the fork's file, so it is recorded before it is written: a stop between
        // the two leaves an attempt that names it, which discovery never lists.
        beforeWritingFork: (file) =>
          recordPreparedSessionFile(input.sql, input.attemptId, file).pipe(
            Effect.tap(() => Effect.sync(() => input.onForkFile(file))),
            Effect.asVoid,
            Effect.mapError((cause) => new Error(String(cause), { cause })),
          ),
      })
      if (result.cancelled) {
        return yield* Effect.fail(
          forkError('fork-cancelled', {
            sourceSessionId: input.command.sourceSessionId,
            targetNodeId,
          }),
        )
      }
      // Inline visualizations are stored with the Session that rendered them. Without the owner in
      // the copied messages' metadata, a fork looked for them in its own, empty store.
      const sourceNodes = yield* input.sql<{ readonly id: string; readonly metadata_json: string }>`
        SELECT id, metadata_json FROM session_nodes WHERE session_id = ${input.command.sourceSessionId}
      `
      const sessionSnapshot = attributeCopiedVisualizationSources(
        result.sessionSnapshot,
        {
          id: SessionId(input.command.sourceSessionId),
          nodes: sourceNodes.map((node) => ({
            id: SessionNodeId(node.id),
            metadataJson: node.metadata_json,
          })),
        },
        result.sourceNodeIdByNodeId,
      )
      return { result: { ...result, sessionSnapshot }, targetNodeId }
    }).pipe(Effect.ensuring(Effect.sync(writer.release)))
  })
}
