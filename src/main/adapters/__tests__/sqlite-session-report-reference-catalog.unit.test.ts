import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionLifecycleRepository } from '../../ports/session-lifecycle-repository'
import { persistSessionReportReferences } from '../sqlite-session-report-reference-catalog'
import { loadAuthorizedReportCandidates } from '../sqlite-session-report-targets'
import {
  makeSessionLifecycleTestLayer,
  spawnLifecycleInput,
} from './sqlite-session-lifecycle-test-support'

const authority: LocalSessionProfileAuthority = {
  profileId: 'reporter',
  profileName: 'reporter',
  capabilities: ['sessions:report'],
  scope: { all: true },
  authorizationCeiling: 'ask-for-approval',
}

const source = {
  session_id: 'session-parent',
  parent_session_id: null,
  hive_root_session_id: null,
}

describe('SQLite Session report reference catalog', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-report-reference-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('uses locale-stable Unicode normalization through its lookup index', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(root, 'unicode.db'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO sessions (id, pi_session_id, project_path, title, archived, created_at, updated_at)
          VALUES (${'unicode-reviewer'}, ${'pi-unicode'}, ${'/authorized'}, ${'  İNCELEME  '}, 0, 2, 2)
        `
        yield* persistSessionReportReferences(sql, {
          sessionId: 'unicode-reviewer',
          title: '  İNCELEME  ',
        })
        const candidates = yield* loadAuthorizedReportCandidates(sql, {
          source,
          target: { type: 'worker-reference', reference: 'i̇nceleme' },
          authority,
        })
        const plan = yield* sql<{ readonly detail: string }>`
          EXPLAIN QUERY PLAN SELECT session_id FROM session_report_references
          WHERE normalized_reference = ${'i̇nceleme'} ORDER BY session_id LIMIT 2
        `
        return { candidates, plan }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.candidates.map((candidate) => candidate.sessionId)).toEqual(['unicode-reviewer'])
    expect(
      result.plan.some((row) => row.detail.includes('idx_session_report_references_lookup')),
    ).toBe(true)
  })

  it('indexes the selected agent definition during fresh lifecycle creation', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(root, 'agent-definition.db'))
    const candidates = await Effect.runPromise(
      Effect.gen(function* () {
        const lifecycle = yield* SessionLifecycleRepository
        const sql = yield* SqlClient.SqlClient
        const input = spawnLifecycleInput()
        yield* lifecycle.execute({
          ...input,
          executionSnapshot: {
            ...input.executionSnapshot,
            profile: {
              ...input.executionSnapshot.profile,
              agentDefinitionName: '  Reviewer-Ü  ',
            },
          },
        })
        return yield* loadAuthorizedReportCandidates(sql, {
          source,
          target: { type: 'worker-reference', reference: 'reviewer-ü' },
          authority,
        })
      }).pipe(Effect.provide(layer)),
    )

    expect(candidates.map((candidate) => candidate.sessionId)).toEqual(['session-worker'])
  })
})
