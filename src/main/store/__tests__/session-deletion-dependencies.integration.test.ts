import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import {
  commitSessionDeletion,
  createSession,
  getSessionDetail,
  listPendingSessionDeletions,
  prepareSessionDeletion,
} from '../session-details'
import { runStoreEffect } from '../store-runtime'

const state = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => state.userDataDir },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

async function makeSession(name: string, withPiFile = false) {
  const piSessionFile = withPiFile ? path.join(state.userDataDir, `${name}.jsonl`) : undefined
  if (piSessionFile) await fs.writeFile(piSessionFile, '{"type":"session_info"}\n', 'utf8')
  const session = await createSession({
    projectPath: state.userDataDir,
    piSessionId: name,
    ...(piSessionFile ? { piSessionFile } : {}),
  })
  return { session, piSessionFile }
}

async function deleteProjection(id: SessionId) {
  const { runAppEffect } = await import('../../runtime')
  return runAppEffect(
    Effect.gen(function* () {
      const repository = yield* SessionProjectionRepository
      yield* repository.delete(id)
    }),
  )
}

async function expectRefusedBeforePiCleanup(id: SessionId, piSessionFile: string) {
  await expect(deleteProjection(id)).rejects.toThrow()
  await expect(fs.stat(piSessionFile)).resolves.toBeDefined()
  await expect(getSessionDetail(id)).resolves.not.toBeNull()
  await expect(listPendingSessionDeletions()).resolves.not.toContain(id)
}

beforeEach(async () => {
  state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-session-delete-'))
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  await promisify(execFile)('git', ['init', state.userDataDir])
})

afterEach(async () => {
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  await fs.rm(state.userDataDir, { recursive: true, force: true })
})

describe('Session deletion dependency safety', () => {
  it('refuses a fork source before Pi cleanup', async () => {
    const source = await makeSession('source', true)
    const derived = await makeSession('derived')
    await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO session_derivations (
            derived_session_id, source_session_id, source_node_id, position, created_at
          ) VALUES (${derived.session.id}, ${source.session.id}, ${'node'}, ${'at'}, ${1})
        `
      }),
    )

    await expectRefusedBeforePiCleanup(source.session.id, source.piSessionFile ?? '')
  })

  it('refuses a hive parent before Pi cleanup', async () => {
    const parent = await makeSession('parent', true)
    const child = await makeSession('child')
    await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO session_runs (id, session_id, status, created_at, updated_at)
          VALUES (${'parent-run'}, ${parent.session.id}, ${'completed'}, ${1}, ${1})
        `
        yield* sql`
          INSERT INTO session_spawn_lineage (
            child_session_id, parent_session_id, parent_run_id,
            hive_root_session_id, depth, created_at
          ) VALUES (
            ${child.session.id}, ${parent.session.id}, ${'parent-run'},
            ${parent.session.id}, ${1}, ${1}
          )
        `
      }),
    )

    await expectRefusedBeforePiCleanup(parent.session.id, parent.piSessionFile ?? '')
  })

  it('deletes owned reports and detaches surviving replies', async () => {
    const reporter = await makeSession('reporter', true)
    const replier = await makeSession('replier')
    await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO cross_session_reports (
            id, correlation_id, source_session_id, authored_by, content, request_reply, created_at
          ) VALUES (
            ${'report'}, ${'correlation'}, ${reporter.session.id}, ${'reporter'}, ${'status'}, ${0}, ${1}
          )
        `
        yield* sql`
          INSERT INTO cross_session_reports (
            id, correlation_id, reply_to_report_id, source_session_id,
            authored_by, content, request_reply, created_at
          ) VALUES (
            ${'reply'}, ${'correlation'}, ${'report'}, ${replier.session.id},
            ${'replier'}, ${'reply'}, ${0}, ${2}
          )
        `
      }),
    )

    await deleteProjection(reporter.session.id)

    await expect(fs.stat(reporter.piSessionFile ?? '')).rejects.toThrow()
    const reports = await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ readonly id: string; readonly reply_to_report_id: string | null }>`
          SELECT id, reply_to_report_id FROM cross_session_reports ORDER BY created_at, id
        `
      }),
    )
    expect(reports).toEqual([{ id: 'reply', reply_to_report_id: null }])
  })

  it('cascades owned Delegation dependency, conflict, review, and verification rows', async () => {
    const parent = await makeSession('delegation-parent')
    const worker = await makeSession('delegation-worker', true)
    const dependent = await makeSession('dependent-worker')
    await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO delegation_contracts (
            id, parent_session_id, child_session_id, state,
            current_specification_revision, created_at, updated_at
          ) VALUES
            (${'target'}, ${parent.session.id}, ${worker.session.id}, ${'working'}, ${1}, ${1}, ${1}),
            (${'dependent'}, ${parent.session.id}, ${dependent.session.id}, ${'working'}, ${1}, ${1}, ${1})
        `
        yield* sql`
          INSERT INTO delegation_dependencies VALUES (${'dependent'}, ${'target'}, ${'accepted'}, ${1})
        `
        yield* sql`
          INSERT INTO delegation_conflicts (
            id, left_delegation_id, right_delegation_id, kind, evidence_json, created_at
          ) VALUES (${'conflict'}, ${'target'}, ${'dependent'}, ${'live-overlap'}, ${'{}'}, ${1})
        `
        yield* sql`
          INSERT INTO delegation_specifications VALUES (${'target'}, ${1}, ${'{}'}, ${'parent'}, ${null}, ${1})
        `
        yield* sql`
          INSERT INTO delegation_submissions (
            delegation_id, revision, specification_revision, summary,
            submitted_by, provenance, created_at
          ) VALUES (${'target'}, ${1}, ${1}, ${'done'}, ${'worker'}, ${'agent-submitted'}, ${1})
        `
        yield* sql`
          INSERT INTO delegation_reviews (
            delegation_id, submission_revision, decision, reviewer_session_id,
            reviewed_by, specification_revision, created_at
          ) VALUES (${'target'}, ${1}, ${'accepted'}, ${parent.session.id}, ${'parent'}, ${1}, ${1})
        `
        yield* sql`
          INSERT INTO delegation_verifications VALUES (
            ${'verification'}, ${'target'}, ${1}, ${1}, ${parent.session.id},
            ${'parent'}, ${'passed'}, ${'verified'}, ${1}
          )
        `
      }),
    )

    await deleteProjection(worker.session.id)

    await expect(fs.stat(worker.piSessionFile ?? '')).rejects.toThrow()
    const remaining = await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ readonly count: number }>`
          SELECT
            (SELECT COUNT(*) FROM delegation_dependencies WHERE dependency_delegation_id = 'target') +
            (SELECT COUNT(*) FROM delegation_conflicts WHERE left_delegation_id = 'target') +
            (SELECT COUNT(*) FROM delegation_reviews WHERE delegation_id = 'target') +
            (SELECT COUNT(*) FROM delegation_verifications WHERE delegation_id = 'target') AS count
        `
      }),
    )
    expect(remaining).toEqual([{ count: 0 }])
  })

  it('refuses a surviving Delegation audit actor before Pi cleanup', async () => {
    const actor = await makeSession('audit-actor', true)
    const parent = await makeSession('audit-parent')
    const worker = await makeSession('audit-worker')
    await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO delegation_contracts VALUES (
            ${'audit'}, ${parent.session.id}, ${worker.session.id}, ${'working'}, ${1}, ${1}, ${1}
          )
        `
        yield* sql`
          INSERT INTO delegation_claim_revisions VALUES (
            ${'audit'}, ${1}, ${actor.session.id}, ${'actor'}, ${'claim'}, ${1}
          )
        `
      }),
    )

    await expectRefusedBeforePiCleanup(actor.session.id, actor.piSessionFile ?? '')
  })

  it('rechecks dependencies atomically after the initial deletion preflight', async () => {
    const actor = await makeSession('racing-audit-actor', true)
    const parent = await makeSession('racing-audit-parent')
    const worker = await makeSession('racing-audit-worker')
    await prepareSessionDeletion(actor.session.id)
    await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO delegation_contracts VALUES (
            ${'racing-audit'}, ${parent.session.id}, ${worker.session.id},
            ${'working'}, ${1}, ${1}, ${1}
          )
        `
        yield* sql`
          INSERT INTO delegation_claim_revisions VALUES (
            ${'racing-audit'}, ${1}, ${actor.session.id}, ${'actor'}, ${'claim'}, ${1}
          )
        `
      }),
    )

    await expectRefusedBeforePiCleanup(actor.session.id, actor.piSessionFile ?? '')
  })

  it('finishes Pi cleanup from the independent journal after the Session row is gone', async () => {
    const target = await makeSession('recover-after-durable-delete', true)
    await prepareSessionDeletion(target.session.id)
    await commitSessionDeletion(target.session.id)

    await expect(getSessionDetail(target.session.id)).resolves.toBeNull()
    await expect(fs.stat(target.piSessionFile ?? '')).resolves.toBeDefined()
    await expect(listPendingSessionDeletions()).resolves.toContain(target.session.id)

    await deleteProjection(target.session.id)

    await expect(fs.stat(target.piSessionFile ?? '')).rejects.toThrow()
    await expect(listPendingSessionDeletions()).resolves.not.toContain(target.session.id)
  })
})
