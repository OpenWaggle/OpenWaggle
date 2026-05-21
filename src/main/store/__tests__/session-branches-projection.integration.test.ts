import lifecycleFs from 'node:fs/promises'
import lifecycleOs from 'node:os'
import lifecyclePath from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionBranchId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runAppEffect } from '../../runtime'
import { createSession, persistSessionSnapshot } from '../session-details'
import { getSessionTree, getSessionWorkspace } from '../sessions'

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

describe('session branch projection', () => {
  it('preserves stable branch identity and active branch state across Pi tree snapshots', async () => {
    const session = await createSession({
      projectPath: '/tmp/project-branches',
      piSessionId: 'pi-session-branches',
      piSessionFile: '/tmp/pi-session-branches.jsonl',
    })
    const sessionId = SessionId(String(session.id))
    const mainBranchId = `${sessionId}:main`

    await persistSessionSnapshot({
      sessionId,
      piSessionId: 'pi-session-branches',
      piSessionFile: '/tmp/pi-session-branches.jsonl',
      activeNodeId: 'main-assistant-1',
      nodes: [
        {
          id: 'root-user',
          parentId: null,
          piEntryType: 'message',
          kind: 'user_message',
          role: 'user',
          timestampMs: 10,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'Start migration plan' }],
            model: null,
          }),
          metadataJson: '{}',
          pathDepth: 0,
          createdOrder: 0,
        },
        {
          id: 'main-assistant-1',
          parentId: 'root-user',
          piEntryType: 'message',
          kind: 'assistant_message',
          role: 'assistant',
          timestampMs: 20,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'Use the main path' }],
            model: 'openai/gpt-5.4',
          }),
          metadataJson: '{}',
          pathDepth: 1,
          createdOrder: 1,
        },
      ],
    })

    await runAppEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          UPDATE session_branch_state
          SET future_mode = ${'waggle'},
              waggle_config_json = ${'{"preserved":true}'},
              ui_state_json = ${'{"collapsed":false}'}
          WHERE branch_id = ${mainBranchId}
        `
      }),
    )

    await persistSessionSnapshot({
      sessionId,
      piSessionId: 'pi-session-branches',
      piSessionFile: '/tmp/pi-session-branches.jsonl',
      activeNodeId: 'branch-assistant',
      nodes: [
        {
          id: 'root-user',
          parentId: null,
          piEntryType: 'message',
          kind: 'user_message',
          role: 'user',
          timestampMs: 10,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'Start migration plan' }],
            model: null,
          }),
          metadataJson: '{}',
          pathDepth: 0,
          createdOrder: 0,
        },
        {
          id: 'main-assistant-1',
          parentId: 'root-user',
          piEntryType: 'message',
          kind: 'assistant_message',
          role: 'assistant',
          timestampMs: 20,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'Use the main path' }],
            model: 'openai/gpt-5.4',
          }),
          metadataJson: '{}',
          pathDepth: 1,
          createdOrder: 1,
        },
        {
          id: 'main-user-2',
          parentId: 'main-assistant-1',
          piEntryType: 'message',
          kind: 'user_message',
          role: 'user',
          timestampMs: 30,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'Continue main path' }],
            model: null,
          }),
          metadataJson: '{}',
          pathDepth: 2,
          createdOrder: 2,
        },
        {
          id: 'main-assistant-2',
          parentId: 'main-user-2',
          piEntryType: 'message',
          kind: 'assistant_message',
          role: 'assistant',
          timestampMs: 40,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'Main path continued' }],
            model: 'openai/gpt-5.4',
          }),
          metadataJson: '{}',
          pathDepth: 3,
          createdOrder: 3,
        },
        {
          id: 'branch-user',
          parentId: 'root-user',
          piEntryType: 'message',
          kind: 'user_message',
          role: 'user',
          timestampMs: 50,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'Try branch path' }],
            model: null,
          }),
          metadataJson: '{}',
          pathDepth: 1,
          createdOrder: 4,
        },
        {
          id: 'branch-assistant',
          parentId: 'branch-user',
          piEntryType: 'message',
          kind: 'assistant_message',
          role: 'assistant',
          timestampMs: 60,
          contentJson: JSON.stringify({
            parts: [{ type: 'text', text: 'Branch path response' }],
            model: 'openai/gpt-5.4',
          }),
          metadataJson: '{}',
          pathDepth: 2,
          createdOrder: 5,
        },
      ],
    })

    const tree = await getSessionTree(sessionId)
    const mainWorkspace = await getSessionWorkspace(sessionId, {
      branchId: SessionBranchId(mainBranchId),
    })
    const activeWorkspace = await getSessionWorkspace(sessionId)
    const mainBranch = tree?.branches.find((branch) => branch.isMain)
    const activeBranch = tree?.branches.find(
      (branch) => branch.id === tree.session.lastActiveBranchId,
    )
    const mainState = tree?.branchStates.find((state) => state.branchId === mainBranch?.id)

    const expectBranchIdentity = () => {
      expect(mainBranch?.id).toBe(mainBranchId)
      expect(mainBranch?.headNodeId).toBe('main-assistant-2')
      expect(activeBranch?.id).toBe(`${sessionId}:branch:branch-user`)
      expect(activeBranch?.headNodeId).toBe('branch-assistant')
      expect(activeBranch?.isMain).toBe(false)
      expect(mainState?.futureMode).toBe('waggle')
      expect(mainState?.uiStateJson).toBe('{"collapsed":false}')
    }
    const expectWorkspacePaths = () => {
      expect(String(mainWorkspace?.activeBranchId)).toBe(mainBranchId)
      expect(String(mainWorkspace?.activeNodeId)).toBe('main-assistant-2')
      expect(mainWorkspace?.transcriptPath.map((entry) => String(entry.node.id))).toEqual([
        'root-user',
        'main-assistant-1',
        'main-user-2',
        'main-assistant-2',
      ])
      expect(String(activeWorkspace?.activeBranchId)).toBe(`${sessionId}:branch:branch-user`)
      expect(activeWorkspace?.transcriptPath.map((entry) => String(entry.node.id))).toEqual([
        'root-user',
        'branch-user',
        'branch-assistant',
      ])
    }

    expectBranchIdentity()
    expectWorkspacePaths()
  })
})
