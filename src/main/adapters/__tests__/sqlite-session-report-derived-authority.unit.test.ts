import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { profileAuthorityForCapabilities } from '../../application/local-session-derived-authority'
import { SessionLifecycleRepository } from '../../ports/session-lifecycle-repository'
import type { ExecuteSessionReportInput } from '../../ports/session-report-repository'
import { SessionReportRepository } from '../../ports/session-report-repository'
import {
  makeSessionLifecycleTestLayer,
  spawnLifecycleInput,
} from './sqlite-session-lifecycle-test-support'

function reportInput(authority: LocalSessionProfileAuthority): ExecuteSessionReportInput {
  return {
    callerId: 'profile:reporter',
    authority,
    request: {
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: 'request-derived-only',
      idempotencyKey: 'idempotency-derived-only',
      command: {
        operation: 'report',
        sessionId: 'session-worker',
        target: { type: 'session', sessionId: 'same-project-unrelated' },
        input: { text: 'Derived-only report.', requestReply: false },
      },
    },
    reportId: 'report-derived-only',
    correlationId: 'correlation-derived-only',
    now: 3000,
  }
}

function derivedOnlyReportAuthority() {
  return profileAuthorityForCapabilities(
    {
      callerId: 'profile:reporter',
      baseProfileScope: { projectPaths: ['/project'] },
      profileAuthority: {
        profileId: 'reporter',
        profileName: 'reporter',
        capabilities: ['sessions:discover'],
        scope: { projectPaths: ['/project'] },
        authorizationCeiling: 'ask-for-approval',
      },
      derivedSessionAuthorities: [
        {
          sessionId: 'session-worker',
          capabilities: ['sessions:report'],
          authorizationCeiling: 'ask-for-approval',
        },
      ],
    },
    ['sessions:report'],
  )
}

describe('SQLite Session derived-only report authorization', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-derived-report-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('rejects an unrelated target in the base profile project scope', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(root, 'report.db'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const lifecycle = yield* SessionLifecycleRepository
        const reports = yield* SessionReportRepository
        const sql = yield* SqlClient.SqlClient
        yield* lifecycle.execute(spawnLifecycleInput())
        yield* sql`
          INSERT INTO sessions (
            id, pi_session_id, project_path, title, archived, created_at, updated_at
          ) VALUES (
            ${'same-project-unrelated'}, ${'pi-unrelated'}, ${'/project'},
            ${'Unrelated session'}, ${0}, ${2}, ${2}
          )
        `
        const authority = derivedOnlyReportAuthority()
        if (!authority) return yield* Effect.die('Expected a projected profile authority.')
        const response = yield* reports.execute(reportInput(authority))
        const [reportsCount] = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM cross_session_reports
        `
        const [deliveriesCount] = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM cross_session_report_deliveries
        `
        return {
          response,
          reportsCount: reportsCount?.count,
          deliveriesCount: deliveriesCount?.count,
        }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.response.outcome).toMatchObject({
      operation: 'report',
      effect: 'rejected',
      code: 'target_not_authorized',
    })
    expect(result.reportsCount).toBe(0)
    expect(result.deliveriesCount).toBe(0)
  })
})
