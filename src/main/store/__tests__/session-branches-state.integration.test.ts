import lifecycleFs from 'node:fs/promises'
import lifecycleOs from 'node:os'
import lifecyclePath from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionBranchId, SessionId, SupportedModelId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectedSessionNodeInput } from '../../ports/session-repository'
import { runAppEffect } from '../../runtime'
import { createSession, persistSessionSnapshot } from '../session-details'
import { getSessionTree, listSessions } from '../sessions'

const BRANCH_CONTRACT_FUTURE_MODES: readonly ['standard', 'waggle'] = ['standard', 'waggle']

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
    lifecyclePath.join(lifecycleOs.tmpdir(), 'ow-session-store-'),
  )
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const tmpDir = state.userDataDir
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  await lifecycleFs.rm(tmpDir, { recursive: true, force: true })
})

describe('session branch state projection', () => {
  it.each(
    BRANCH_CONTRACT_FUTURE_MODES,
  )('preserves %s branch future-mode state across Pi reprojection', async (futureMode) => {
    const session = await createSession({
      projectPath: `/tmp/project-${futureMode}-branch-contract`,
      piSessionId: `pi-session-${futureMode}-branch-contract`,
      piSessionFile: `/tmp/pi-session-${futureMode}-branch-contract.jsonl`,
    })
    const sessionId = SessionId(String(session.id))
    const mainBranchId = `${sessionId}:main`
    const nodes: ProjectedSessionNodeInput[] = [
      {
        id: 'root-user',
        parentId: null,
        piEntryType: 'message',
        kind: 'user_message',
        role: 'user',
        timestampMs: 10,
        contentJson: JSON.stringify({
          parts: [{ type: 'text', text: 'Start' }],
          model: null,
        }),
        metadataJson: '{}',
        pathDepth: 0,
        createdOrder: 0,
      },
      {
        id: 'assistant-1',
        parentId: 'root-user',
        piEntryType: 'message',
        kind: 'assistant_message',
        role: 'assistant',
        timestampMs: 20,
        contentJson: JSON.stringify({
          parts: [{ type: 'text', text: 'Continue' }],
          model: 'openai/gpt-5.4',
        }),
        metadataJson: '{}',
        pathDepth: 1,
        createdOrder: 1,
      },
    ]

    await persistSessionSnapshot({
      sessionId,
      piSessionId: `pi-session-${futureMode}-branch-contract`,
      piSessionFile: `/tmp/pi-session-${futureMode}-branch-contract.jsonl`,
      activeNodeId: 'assistant-1',
      nodes,
    })

    await runAppEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
            UPDATE session_branch_state
            SET future_mode = ${futureMode},
                ui_state_json = ${`{"mode":"${futureMode}"}`}
            WHERE branch_id = ${mainBranchId}
          `
      }),
    )

    await persistSessionSnapshot({
      sessionId,
      piSessionId: `pi-session-${futureMode}-branch-contract`,
      piSessionFile: `/tmp/pi-session-${futureMode}-branch-contract.jsonl`,
      activeNodeId: 'assistant-1',
      nodes,
    })

    const tree = await getSessionTree(sessionId)
    const branchState = tree?.branchStates.find((state) => String(state.branchId) === mainBranchId)

    expect(branchState?.futureMode).toBe(futureMode)
    expect(branchState?.uiStateJson).toBe(`{"mode":"${futureMode}"}`)
  })

  it('preserves interrupted run indicators across Pi reprojection', async () => {
    const session = await createSession({
      projectPath: '/tmp/project-interrupted-run',
      piSessionId: 'pi-session-interrupted-run',
      piSessionFile: '/tmp/pi-session-interrupted-run.jsonl',
    })
    const sessionId = SessionId(String(session.id))
    const branchId = SessionBranchId(`${sessionId}:main`)
    const nodes: ProjectedSessionNodeInput[] = [
      {
        id: 'root-user',
        parentId: null,
        piEntryType: 'message',
        kind: 'user_message',
        role: 'user',
        timestampMs: 10,
        contentJson: JSON.stringify({
          parts: [{ type: 'text', text: 'Start' }],
          model: null,
        }),
        metadataJson: '{}',
        pathDepth: 0,
        createdOrder: 0,
      },
      {
        id: 'assistant-1',
        parentId: 'root-user',
        piEntryType: 'message',
        kind: 'assistant_message',
        role: 'assistant',
        timestampMs: 20,
        contentJson: JSON.stringify({
          parts: [{ type: 'text', text: 'Continue' }],
          model: 'openai/gpt-5.4',
        }),
        metadataJson: '{}',
        pathDepth: 1,
        createdOrder: 1,
      },
    ]

    await persistSessionSnapshot({
      sessionId,
      piSessionId: 'pi-session-interrupted-run',
      piSessionFile: '/tmp/pi-session-interrupted-run.jsonl',
      activeNodeId: 'assistant-1',
      nodes,
    })

    await runAppEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO session_active_runs (
            run_id,
            session_id,
            branch_id,
            run_mode,
            status,
            runtime_json,
            updated_at
          )
          VALUES (
            ${'run-interrupted-1'},
            ${sessionId},
            ${branchId},
            ${'classic'},
            ${'interrupted'},
            ${JSON.stringify({ model: 'openai/gpt-5.4' })},
            ${100}
          )
        `
      }),
    )

    await persistSessionSnapshot({
      sessionId,
      piSessionId: 'pi-session-interrupted-run',
      piSessionFile: '/tmp/pi-session-interrupted-run.jsonl',
      activeNodeId: 'assistant-1',
      nodes,
    })

    const tree = await getSessionTree(sessionId)
    const sessions = await listSessions()
    const treeMainBranch = tree?.branches.find((branch) => branch.id === branchId)
    const listMainBranch = sessions[0]?.branches?.find((branch) => branch.id === branchId)

    expect(treeMainBranch?.interruptedRun).toEqual({
      runId: 'run-interrupted-1',
      sessionId,
      branchId,
      runMode: 'classic',
      model: SupportedModelId('openai/gpt-5.4'),
      interruptedAt: 100,
    })
    expect(listMainBranch?.interruptedRun?.runId).toBe('run-interrupted-1')
  })
})
