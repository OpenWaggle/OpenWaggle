import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession } from '../session-details'
import { listHiveSessionCatalogPage } from '../sessions/session-catalog'
import { listSessions } from '../sessions/session-list'
import { runStoreEffect } from '../store-runtime'

const { state, getPathMock } = vi.hoisted(() => ({
  state: { userDataDir: '' },
  getPathMock: vi.fn(() => ''),
}))

getPathMock.mockImplementation(() => state.userDataDir)

vi.mock('electron', () => ({
  app: { getPath: getPathMock },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

beforeEach(async () => {
  state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-historical-hive-'))
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const directory = state.userDataDir
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  await fs.rm(directory, { recursive: true, force: true })
})

describe('historical MCP Hive display', () => {
  it('shows old Queen and Worker links without granting Host delegation authority', async () => {
    const queen = await createSession({
      projectPath: '/repo/legacy',
      piSessionId: 'pi-legacy-queen',
    })
    const worker = await createSession({
      projectPath: '/repo/legacy',
      piSessionId: 'pi-legacy-worker',
    })
    await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO session_lineage (
            session_id, parent_session_id, agent_definition_name,
            delegation_state, created_at, updated_at
          ) VALUES (${worker.id}, ${queen.id}, ${'reviewer'}, ${'working'}, ${1}, ${1})
        `
      }),
    )

    const listed = await listSessions()
    expect(listed.find((session) => session.id === queen.id)?.lineage).toMatchObject({
      role: 'queen',
      directWorkerCount: 1,
      activeDirectWorkerCount: 0,
    })
    expect(listed.find((session) => session.id === worker.id)?.lineage).toMatchObject({
      role: 'worker',
      parentSessionId: queen.id,
      agentDefinitionName: 'reviewer',
      delegationState: 'working',
      historical: true,
    })

    const queenPage = await listHiveSessionCatalogPage(queen.id, 50)
    const workerPage = await listHiveSessionCatalogPage(worker.id, 50)
    expect(queenPage.workers.map((session) => session.id)).toEqual([worker.id])
    expect(workerPage.context.map((session) => session.id)).toContain(queen.id)
    expect(workerPage.context.map((session) => session.id)).toContain(worker.id)
    const grants = await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM derived_child_management_grants
        `
      }),
    )
    expect(grants[0]?.count).toBe(0)
  })
})
