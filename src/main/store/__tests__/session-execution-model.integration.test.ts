import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createSession, getSessionDetail } from '../session-details'
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
  state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-session-model-'))
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  await fs.rm(state.userDataDir, { recursive: true, force: true })
})

it('hydrates the immutable execution model captured for a Session', async () => {
  const session = await createSession({ projectPath: '/project', piSessionId: 'session-model' })
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        INSERT INTO session_execution_profiles (
          session_id, profile_json, authority_origin_caller_id,
          authorization_ceiling, created_at, updated_at
        ) VALUES (
          ${session.id},
          ${JSON.stringify({ modelId: 'openai/gpt-5.4', thinkingLevel: 'high' })},
          ${'gui:local-user'}, ${'yolo'}, ${1}, ${1}
        )
      `
    }),
  )

  await expect(getSessionDetail(session.id)).resolves.toMatchObject({
    executionModel: 'openai/gpt-5.4',
  })
})
