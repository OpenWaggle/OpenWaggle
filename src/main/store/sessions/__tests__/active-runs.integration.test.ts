import lifecycleFs from 'node:fs/promises'
import lifecycleOs from 'node:os'
import lifecyclePath from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionBranchId, SessionId, SupportedModelId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runAppEffect } from '../../../runtime'
import { createSession, persistSessionSnapshot } from '../../session-details'
import {
  clearInterruptedSessionRuns,
  clearSessionActiveRun,
  listSessionActiveRunsForRecovery,
  markSessionActiveRunInterrupted,
  recordSessionActiveRun,
} from '../active-runs'

const { state, getPathMock } = vi.hoisted(() => ({
  state: { userDataDir: '' },
  getPathMock: vi.fn(() => ''),
}))

getPathMock.mockImplementation(() => state.userDataDir)

vi.mock('electron', () => ({
  app: {
    getPath: getPathMock,
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

beforeEach(async () => {
  state.userDataDir = await lifecycleFs.mkdtemp(
    lifecyclePath.join(lifecycleOs.tmpdir(), 'ow-active-runs-'),
  )
  const { resetAppRuntimeForTests } = await import('../../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const tmpDir = state.userDataDir
  const { resetAppRuntimeForTests } = await import('../../../runtime')
  await resetAppRuntimeForTests()
  await lifecycleFs.rm(tmpDir, { recursive: true, force: true })
})

async function createProjectedSession() {
  const session = await createSession({
    projectPath: '/tmp/project-active-run',
    piSessionId: 'pi-session-active-run',
    piSessionFile: '/tmp/pi-session-active-run.jsonl',
  })
  const sessionId = SessionId(String(session.id))
  await persistSessionSnapshot({
    sessionId,
    piSessionId: 'pi-session-active-run',
    piSessionFile: '/tmp/pi-session-active-run.jsonl',
    activeNodeId: 'root-user',
    nodes: [
      {
        id: 'root-user',
        parentId: null,
        piEntryType: 'message',
        kind: 'user_message',
        role: 'user',
        timestampMs: 10,
        contentJson: JSON.stringify({ parts: [{ type: 'text', text: 'Start' }], model: null }),
        metadataJson: '{}',
        pathDepth: 0,
        createdOrder: 0,
      },
    ],
  })
  return {
    sessionId,
    branchId: SessionBranchId(`${String(sessionId)}:main`),
  }
}

async function activeRunStatuses() {
  return runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ readonly status: string }>`
        SELECT status FROM session_active_runs ORDER BY run_id ASC
      `
      return rows.map((row) => row.status)
    }),
  )
}

describe('session active run persistence', () => {
  it('records recoverable active runs and removes them after completion or interrupted cleanup', async () => {
    const { sessionId, branchId } = await createProjectedSession()

    await recordSessionActiveRun({
      runId: 'run-1',
      sessionId,
      branchId,
      runMode: 'classic',
      model: SupportedModelId('openai/gpt-5.5'),
    })

    expect(await listSessionActiveRunsForRecovery()).toEqual([
      {
        runId: 'run-1',
        sessionId,
        branchId,
        runMode: 'classic',
        model: SupportedModelId('openai/gpt-5.5'),
      },
    ])

    await markSessionActiveRunInterrupted({ sessionId, runId: 'run-1' })
    expect(await listSessionActiveRunsForRecovery()).toEqual([])
    expect(await activeRunStatuses()).toEqual(['interrupted'])

    await clearInterruptedSessionRuns({ sessionId, branchId })
    expect(await activeRunStatuses()).toEqual([])

    await recordSessionActiveRun({
      runId: 'run-2',
      sessionId,
      branchId,
      runMode: 'waggle',
      model: SupportedModelId('anthropic/claude-sonnet-4'),
    })
    await clearSessionActiveRun({ sessionId, runId: 'run-2' })

    expect(await listSessionActiveRunsForRecovery()).toEqual([])
  })
})
