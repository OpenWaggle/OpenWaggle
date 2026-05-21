import lifecycleFs from 'node:fs/promises'
import lifecycleOs from 'node:os'
import lifecyclePath from 'node:path'
import { SessionBranchId, SessionId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectedSessionNodeInput } from '../../ports/session-repository'
import { createSession, persistSessionSnapshot } from '../session-details'
import {
  archiveSessionBranch,
  getSessionTree,
  listArchivedSessionBranches,
  listSessions,
} from '../sessions'

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

describe('session branch archive projection', () => {
  it('archives a branch without deleting it from the session tree projection', async () => {
    const session = await createSession({
      projectPath: '/tmp/project-archived-branch',
      piSessionId: 'pi-session-archived-branch',
      piSessionFile: '/tmp/pi-session-archived-branch.jsonl',
    })
    const sessionId = SessionId(String(session.id))
    const branchId = SessionBranchId(`${sessionId}:branch:branch-user`)
    const nodes: ProjectedSessionNodeInput[] = [
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
        id: 'main-assistant',
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
        id: 'branch-user',
        parentId: 'root-user',
        piEntryType: 'message',
        kind: 'user_message',
        role: 'user',
        timestampMs: 30,
        contentJson: JSON.stringify({
          parts: [{ type: 'text', text: 'Try branch path' }],
          model: null,
        }),
        metadataJson: '{}',
        pathDepth: 1,
        createdOrder: 2,
      },
      {
        id: 'branch-assistant',
        parentId: 'branch-user',
        piEntryType: 'message',
        kind: 'assistant_message',
        role: 'assistant',
        timestampMs: 40,
        contentJson: JSON.stringify({
          parts: [{ type: 'text', text: 'Branch path response' }],
          model: 'openai/gpt-5.4',
        }),
        metadataJson: '{}',
        pathDepth: 2,
        createdOrder: 3,
      },
    ]

    await persistSessionSnapshot({
      sessionId,
      piSessionId: 'pi-session-archived-branch',
      piSessionFile: '/tmp/pi-session-archived-branch.jsonl',
      activeNodeId: 'branch-assistant',
      nodes,
    })

    await archiveSessionBranch(sessionId, branchId)

    const archivedTree = await getSessionTree(sessionId)
    const archivedBranch = archivedTree?.branches.find((branch) => branch.id === branchId)
    const sessionSummary = (await listSessions()).find((session) => session.id === sessionId)

    const expectArchivedVisibleState = () => {
      expect(archivedTree?.branches).toHaveLength(2)
      expect(archivedBranch?.archived).toBe(true)
      expect(String(archivedTree?.session.lastActiveBranchId)).toBe(`${sessionId}:main`)
      expect(sessionSummary?.branches?.map((branch) => branch.name)).toEqual(['main'])
    }

    const archivedBranchSummaries = await listArchivedSessionBranches()
    const archivedBranchSummary = archivedBranchSummaries.find(
      (session) => session.id === sessionId,
    )
    const expectArchivedSummary = () => {
      expect(archivedBranchSummary?.projectPath).toBe('/tmp/project-archived-branch')
      expect(archivedBranchSummary?.branches?.map((branch) => branch.name)).toEqual([
        'Start migration plan',
      ])
    }

    expectArchivedVisibleState()
    expectArchivedSummary()

    await persistSessionSnapshot({
      sessionId,
      piSessionId: 'pi-session-archived-branch',
      piSessionFile: '/tmp/pi-session-archived-branch.jsonl',
      activeNodeId: 'branch-assistant',
      nodes,
    })

    const refreshedTree = await getSessionTree(sessionId)
    const refreshedBranch = refreshedTree?.branches.find((branch) => branch.id === branchId)

    const expectRefreshedArchiveState = () => {
      expect(refreshedTree?.branches).toHaveLength(2)
      expect(refreshedBranch?.archived).toBe(true)
      expect(String(refreshedTree?.session.lastActiveBranchId)).toBe(`${sessionId}:main`)
      expect(String(refreshedTree?.session.lastActiveNodeId)).toBe('main-assistant')
    }

    expectRefreshedArchiveState()
  })
})
