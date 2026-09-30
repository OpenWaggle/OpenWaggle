import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession, getSessionCallerAuthorizationBoundary } from '../session-details'
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

const PROFILE_JSON = '{"modelId":"provider/model","thinkingLevel":"medium"}'

function seedYoloSessionRuns(sessionId: string) {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO session_execution_profiles (
        session_id, profile_json, authority_origin_caller_id, authorization_ceiling,
        created_at, updated_at
      ) VALUES (${sessionId}, ${PROFILE_JSON}, ${'local-user'}, ${'yolo'}, ${1}, ${1})`
      yield* sql`INSERT INTO session_client_profiles (
        id, name, credential_verifier, capabilities_json, scope_json, authorization_ceiling,
        created_at, updated_at
      ) VALUES (
        ${'asker'}, ${'asker'}, ${'verifier'}, ${'[]'}, ${'{"all":true}'},
        ${'ask-for-approval'}, ${1}, ${1}
      )`
      const runs = [
        ['run-by-user', 'local-user'],
        ['run-by-asker', 'profile:asker'],
      ] as const
      for (const [runId, callerId] of runs) {
        yield* sql`INSERT INTO session_runs (
          id, session_id, status, intent_json, created_at, updated_at
        ) VALUES (
          ${runId}, ${sessionId}, ${'active'}, ${JSON.stringify({ callerId })}, ${1}, ${1}
        )`
      }
    }),
  )
}

describe('Session caller authorization boundary', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-caller-boundary-')),
    )
    state.userDataDir = path.join(temporaryRoot, 'user-data')
    await fs.mkdir(state.userDataDir)
    const { resetAppRuntimeForTests } = await import('../../runtime')
    await resetAppRuntimeForTests()
  })

  afterEach(async () => {
    const { resetAppRuntimeForTests } = await import('../../runtime')
    await resetAppRuntimeForTests()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it("bounds a Session agent by whoever started its Run, not by its Session's ceiling", async () => {
    const projectPath = path.join(temporaryRoot, 'project')
    await fs.mkdir(projectPath)
    const session = await createSession({ projectPath, piSessionId: 'pi-caller-boundary' })
    const sessionId = String(session.id)
    await seedYoloSessionRuns(sessionId)

    await expect(
      getSessionCallerAuthorizationBoundary(`session-agent:${sessionId}:run-by-user`),
    ).resolves.toMatchObject({ authorizationCeiling: 'yolo', revoked: false })
    // An ask-for-approval profile started this Run, so its agent cannot act yolo.
    await expect(
      getSessionCallerAuthorizationBoundary(`session-agent:${sessionId}:run-by-asker`),
    ).resolves.toMatchObject({ authorizationCeiling: 'ask-for-approval' })
    // A Run the Host cannot find fails closed.
    await expect(
      getSessionCallerAuthorizationBoundary(`session-agent:${sessionId}:run-missing`),
    ).resolves.toMatchObject({ authorizationCeiling: 'ask-for-approval' })
  })
})
