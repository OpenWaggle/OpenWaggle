import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import type {
  LocalSessionProfileAuthority,
  LocalSessionProfileScope,
} from '@shared/types/local-session-profile'
import type { SessionControlReportTarget } from '@shared/types/session-collaboration'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionLifecycleRepository } from '../../ports/session-lifecycle-repository'
import type { ExecuteSessionReportInput } from '../../ports/session-report-repository'
import { SessionReportRepository } from '../../ports/session-report-repository'
import { loadAuthorizedReportCandidates } from '../sqlite-session-report-targets'
import {
  makeSessionLifecycleTestLayer,
  spawnLifecycleInput,
} from './sqlite-session-lifecycle-test-support'

function reportAuthority(scope: LocalSessionProfileScope): LocalSessionProfileAuthority {
  return {
    profileId: 'reporter',
    profileName: 'reporter',
    capabilities: ['sessions:report'],
    scope,
    authorizationCeiling: 'ask-for-approval',
  }
}

function reportInput(
  target: SessionControlReportTarget,
  authority: LocalSessionProfileAuthority,
  suffix: string,
): ExecuteSessionReportInput {
  return {
    callerId: 'profile:reporter',
    authority,
    request: {
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: `request-${suffix}`,
      idempotencyKey: `idempotency-${suffix}`,
      command: {
        operation: 'report',
        sessionId: 'session-worker',
        target,
        input: { text: `Report ${suffix}.`, requestReply: false },
      },
    },
    reportId: `report-${suffix}`,
    correlationId: `correlation-${suffix}`,
    now: 3000,
  }
}

function insertLargeUnrelatedCatalog(sql: SqlClient.SqlClient, title = 'Unrelated') {
  return sql`
    WITH RECURSIVE sequence(value) AS (
      SELECT 1
      UNION ALL
      SELECT value + 1 FROM sequence WHERE value < 500
    )
    INSERT INTO sessions (
      id, pi_session_id, project_path, title, archived, created_at, updated_at
    )
    SELECT
      printf('unrelated-%04d', value), printf('pi-unrelated-%04d', value),
      ${'/unauthorized'}, ${title}, 0, value, value
    FROM sequence
  `
}

function insertSession(
  sql: SqlClient.SqlClient,
  input: { readonly id: string; readonly projectPath: string; readonly title: string },
) {
  return sql`
    INSERT INTO sessions (
      id, pi_session_id, project_path, title, archived, created_at, updated_at
    ) VALUES (
      ${input.id}, ${`pi-${input.id}`}, ${input.projectPath}, ${input.title}, ${0}, ${2}, ${2}
    )
  `
}

describe('SQLite Session report target selection', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-report-targets-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('bounds Worker-reference candidates after applying authority to a large catalog', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(root, 'reference.db'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const lifecycle = yield* SessionLifecycleRepository
        const reports = yield* SessionReportRepository
        const sql = yield* SqlClient.SqlClient
        yield* lifecycle.execute(spawnLifecycleInput())
        yield* insertLargeUnrelatedCatalog(sql, 'Reviewer')
        yield* insertSession(sql, {
          id: 'allowed-reviewer-a',
          projectPath: '/authorized',
          title: 'Reviewer',
        })
        const authority = reportAuthority({ projectPaths: ['/authorized'] })
        const uniqueCandidates = yield* loadAuthorizedReportCandidates(sql, {
          source: {
            session_id: 'session-worker',
            parent_session_id: 'session-parent',
            hive_root_session_id: 'session-parent',
          },
          target: { type: 'worker-reference', reference: ' reviewer ' },
          authority,
        })
        const unique = yield* reports.execute(
          reportInput({ type: 'worker-reference', reference: ' reviewer ' }, authority, 'unique'),
        )
        for (const id of ['allowed-reviewer-b', 'allowed-reviewer-c']) {
          yield* insertSession(sql, { id, projectPath: '/authorized', title: 'Reviewer' })
        }
        const ambiguousCandidates = yield* loadAuthorizedReportCandidates(sql, {
          source: {
            session_id: 'session-worker',
            parent_session_id: 'session-parent',
            hive_root_session_id: 'session-parent',
          },
          target: { type: 'worker-reference', reference: ' reviewer ' },
          authority,
        })
        const ambiguous = yield* reports.execute(
          reportInput(
            { type: 'worker-reference', reference: ' reviewer ' },
            authority,
            'ambiguous',
          ),
        )
        return { uniqueCandidates, unique, ambiguousCandidates, ambiguous }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.uniqueCandidates.map((candidate) => candidate.sessionId)).toEqual([
      'allowed-reviewer-a',
    ])
    expect(result.unique.outcome).toMatchObject({
      operation: 'report',
      effect: 'accepted-report',
      targetSessionIds: ['allowed-reviewer-a'],
    })
    expect(result.ambiguousCandidates.map((candidate) => candidate.sessionId)).toEqual([
      'allowed-reviewer-a',
      'allowed-reviewer-b',
    ])
    expect(result.ambiguous.outcome).toMatchObject({
      operation: 'report',
      effect: 'rejected',
      code: 'target_ambiguous',
    })
  })

  it('loads only requested IDs while preserving authorization and narrow Hive routes', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(root, 'explicit.db'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const lifecycle = yield* SessionLifecycleRepository
        const reports = yield* SessionReportRepository
        const sql = yield* SqlClient.SqlClient
        yield* lifecycle.execute(spawnLifecycleInput())
        yield* insertLargeUnrelatedCatalog(sql)
        yield* insertSession(sql, {
          id: 'explicit-authorized',
          projectPath: '/authorized',
          title: 'Allowed target',
        })
        yield* insertSession(sql, {
          id: 'explicit-denied',
          projectPath: '/unauthorized',
          title: 'Denied target',
        })
        yield* insertSession(sql, {
          id: 'direct-worker',
          projectPath: '/unauthorized',
          title: 'Direct Worker',
        })
        yield* sql`
          INSERT INTO session_spawn_lineage (
            child_session_id, parent_session_id, parent_run_id,
            hive_root_session_id, depth, created_at
          ) VALUES (
            ${'direct-worker'}, ${'session-worker'}, ${'run-worker'},
            ${'session-parent'}, ${2}, ${2}
          )
        `
        const authority = reportAuthority({ sessionIds: ['explicit-authorized'] })
        const candidates = yield* loadAuthorizedReportCandidates(sql, {
          source: {
            session_id: 'session-worker',
            parent_session_id: 'session-parent',
            hive_root_session_id: 'session-parent',
          },
          target: {
            type: 'sessions',
            sessionIds: ['explicit-authorized', 'explicit-denied'],
          },
          authority,
        })
        const denied = yield* reports.execute(
          reportInput({ type: 'session', sessionId: 'explicit-denied' }, authority, 'denied'),
        )
        const authorized = yield* reports.execute(
          reportInput(
            { type: 'session', sessionId: 'explicit-authorized' },
            authority,
            'authorized',
          ),
        )
        const upstream = yield* reports.execute(
          reportInput({ type: 'upstream' }, reportAuthority({}), 'upstream'),
        )
        const directWorker = yield* reports.execute(
          reportInput(
            { type: 'session', sessionId: 'direct-worker' },
            reportAuthority({}),
            'direct-worker',
          ),
        )
        return { candidates, denied, authorized, upstream, directWorker }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.candidates.map((candidate) => candidate.sessionId)).toEqual([
      'explicit-authorized',
    ])
    expect(result.denied.outcome).toMatchObject({
      effect: 'rejected',
      code: 'target_not_authorized',
    })
    expect(result.authorized.outcome).toMatchObject({
      effect: 'accepted-report',
      targetSessionIds: ['explicit-authorized'],
    })
    expect(result.upstream.outcome).toMatchObject({
      effect: 'accepted-report',
      targetSessionIds: ['session-parent'],
    })
    expect(result.directWorker.outcome).toMatchObject({
      effect: 'accepted-report',
      targetSessionIds: ['direct-worker'],
    })
  })
})
