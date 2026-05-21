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
  listSessions,
  renameSessionBranch,
  restoreSessionBranch,
  updateSessionTreeUiState,
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

describe('session branch mutations', () => {
  it('restores an archived branch without selecting it automatically', async () => {
    const session = await createSession({
      projectPath: '/tmp/project-restored-branch',
      piSessionId: 'pi-session-restored-branch',
      piSessionFile: '/tmp/pi-session-restored-branch.jsonl',
    })
    const sessionId = SessionId(String(session.id))
    const branchId = SessionBranchId(`${sessionId}:branch:branch-user`)

    await persistSessionSnapshot({
      sessionId,
      piSessionId: 'pi-session-restored-branch',
      piSessionFile: '/tmp/pi-session-restored-branch.jsonl',
      activeNodeId: 'main-assistant',
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
      ],
    })

    await archiveSessionBranch(sessionId, branchId)
    await restoreSessionBranch(sessionId, branchId)

    const restoredTree = await getSessionTree(sessionId)
    const restoredBranch = restoredTree?.branches.find((branch) => branch.id === branchId)

    expect(restoredBranch?.archived).toBeUndefined()
    expect(restoredBranch?.archivedAt).toBeNull()
    expect(String(restoredTree?.session.lastActiveBranchId)).toBe(`${sessionId}:main`)
  })

  it('rejects branch mutations for main or missing branches', async () => {
    const session = await createSession({
      projectPath: '/tmp/project-branch-mutation-validation',
      piSessionId: 'pi-session-branch-mutation-validation',
      piSessionFile: '/tmp/pi-session-branch-mutation-validation.jsonl',
    })
    const sessionId = SessionId(String(session.id))

    await persistSessionSnapshot({
      sessionId,
      piSessionId: 'pi-session-branch-mutation-validation',
      piSessionFile: '/tmp/pi-session-branch-mutation-validation.jsonl',
      activeNodeId: null,
      nodes: [],
    })

    await expect(
      archiveSessionBranch(sessionId, SessionBranchId(`${sessionId}:main`)),
    ).rejects.toThrow('Session branch not found or cannot be modified.')
    await expect(
      renameSessionBranch(sessionId, SessionBranchId(`${sessionId}:missing`), 'Missing'),
    ).rejects.toThrow('Session branch not found or cannot be modified.')
    await expect(
      restoreSessionBranch(sessionId, SessionBranchId(`${sessionId}:missing`)),
    ).rejects.toThrow('Session branch not found or cannot be modified.')
  })

  it('renames a non-main branch and preserves the custom name across snapshots', async () => {
    const session = await createSession({
      projectPath: '/tmp/project-renamed-branch',
      piSessionId: 'pi-session-renamed-branch',
      piSessionFile: '/tmp/pi-session-renamed-branch.jsonl',
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
      piSessionId: 'pi-session-renamed-branch',
      piSessionFile: '/tmp/pi-session-renamed-branch.jsonl',
      activeNodeId: 'branch-assistant',
      nodes,
    })

    await renameSessionBranch(sessionId, branchId, 'OAuth retry path')

    const renamedTree = await getSessionTree(sessionId)
    const renamedBranch = renamedTree?.branches.find((branch) => branch.id === branchId)

    expect(renamedBranch?.name).toBe('OAuth retry path')

    await persistSessionSnapshot({
      sessionId,
      piSessionId: 'pi-session-renamed-branch',
      piSessionFile: '/tmp/pi-session-renamed-branch.jsonl',
      activeNodeId: 'branch-assistant',
      nodes,
    })

    const refreshedTree = await getSessionTree(sessionId)
    const refreshedBranch = refreshedTree?.branches.find((branch) => branch.id === branchId)

    expect(refreshedBranch?.name).toBe('OAuth retry path')
  })

  it('persists branch-list collapse state for session navigation summaries', async () => {
    const session = await createSession({
      projectPath: '/tmp/project-tree-ui-state',
      piSessionId: 'pi-session-tree-ui-state',
      piSessionFile: '/tmp/pi-session-tree-ui-state.jsonl',
    })
    const sessionId = SessionId(String(session.id))

    await updateSessionTreeUiState(sessionId, { branchesSidebarCollapsed: true })

    const summary = (await listSessions()).find((session) => session.id === sessionId)
    const tree = await getSessionTree(sessionId)

    expect(summary?.treeUiState?.branchesSidebarCollapsed).toBe(true)
    expect(tree?.uiState?.branchesSidebarCollapsed).toBe(true)
  })
})
