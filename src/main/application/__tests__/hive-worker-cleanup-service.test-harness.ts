import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import type { ActionRun } from '@shared/types/action-runs'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import type { SessionHostEventPayload } from '@shared/types/session-host-event'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach } from 'vitest'
import { makeHiveWorkerCleanupTestLayer } from '../../adapters/__tests__/hive-worker-cleanup-fixture'
import { TerminalService, type TerminalServiceShape } from '../../ports/terminal-service'
import { installSessionHostEventPublisher } from '../../session-host/session-host-events'
import { organizeSession } from '../session-organization-service'

export function archivedState(sql: SqlClient.SqlClient, sessionId: string) {
  return sql<{ readonly archived: number }>`
    SELECT archived FROM sessions WHERE id = ${sessionId}
  `.pipe(Effect.map((rows) => rows[0]?.archived))
}

export function unarchive(callerId: string, key: string) {
  return organizeSession({
    callerId,
    request: {
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: key,
      idempotencyKey: key,
      command: { operation: 'unarchive', sessionId: 'worker' },
    },
  })
}

/** Replaces selected TerminalService operations of the store's no-op desktop. */
export function withTerminals<A, E, R>(
  overrides: (sql: SqlClient.SqlClient) => Partial<TerminalServiceShape>,
  effect: Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const base = yield* TerminalService
    return yield* effect.pipe(
      Effect.provideService(TerminalService, { ...base, ...overrides(sql) }),
    )
  })
}

export function bindWorkerWorkspace(sql: SqlClient.SqlClient, sessionIds: readonly string[]) {
  return Effect.gen(function* () {
    yield* sql`
      INSERT INTO workspace_resources (
        id, project_path, kind, working_path, lifecycle_state,
        worktree_start_from_origin, created_at, updated_at
      ) VALUES (
        ${'workspace-worker'}, ${'/project'}, ${'managed-worktree'}, ${'/project/.worktrees/w'},
        ${'ready'}, ${0}, ${1000}, ${1000}
      )
    `
    for (const sessionId of sessionIds) {
      yield* sql`
        INSERT INTO session_workspace_bindings (session_id, workspace_id, bound_at)
        VALUES (${sessionId}, ${'workspace-worker'}, ${1000})
      `
    }
  })
}

export function runningService(): ActionRun {
  return fromPartial<ActionRun>({
    id: 'action-run-dev',
    workspaceId: 'workspace-worker',
    status: 'running',
    action: fromPartial({ id: 'dev', kind: 'service' }),
  })
}

/** A fresh SQLite store per test, plus the Session Host events the service published. */
export function useHiveCleanupServiceContext(prefix: string) {
  const context: {
    temporaryRoot: string
    events: SessionHostEventPayload[]
    readonly store: (name: string) => ReturnType<typeof makeHiveWorkerCleanupTestLayer>
  } = {
    temporaryRoot: '',
    events: [],
    store: (name: string) =>
      makeHiveWorkerCleanupTestLayer(path.join(context.temporaryRoot, `${name}.sqlite`)),
  }
  let releasePublisher: (() => void) | undefined
  beforeEach(async () => {
    context.temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
    context.events = []
    releasePublisher = installSessionHostEventPublisher((event) => context.events.push(event))
  })
  afterEach(async () => {
    releasePublisher?.()
    await fs.rm(context.temporaryRoot, { recursive: true, force: true })
  })
  return context
}
