import { SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionWorkspace } from '@shared/types/session'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveCurrentConversationNode } from '../current-conversation-node'

const apiMock = vi.hoisted(() => ({ getSessionWorkspace: vi.fn() }))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMock }))

const SESSION_ID = SessionId('session-1')
const BRANCH_ID = SessionBranchId('session-1:branch')

function workspace(activeNodeId: string, branchHead: string | null): SessionWorkspace {
  return {
    tree: {
      session: {
        id: SESSION_ID,
        title: 'Session',
        projectPath: '/repo',
        createdAt: 1,
        updatedAt: 1,
        lastActiveNodeId: SessionNodeId(activeNodeId),
        lastActiveBranchId: branchHead ? BRANCH_ID : null,
      },
      nodes: [],
      branches: branchHead
        ? [
            {
              id: BRANCH_ID,
              sessionId: SESSION_ID,
              sourceNodeId: null,
              headNodeId: SessionNodeId(branchHead),
              name: 'Branch 2',
              isMain: false,
              createdAt: 1,
              updatedAt: 1,
            },
          ]
        : [],
      branchStates: [],
      uiState: null,
    },
    activeBranchId: branchHead ? BRANCH_ID : null,
    activeNodeId: SessionNodeId(activeNodeId),
    transcriptPath: [],
  }
}

describe('resolveCurrentConversationNode', () => {
  beforeEach(() => {
    apiMock.getSessionWorkspace.mockReset()
  })

  it('keeps an earlier node the view selected explicitly', async () => {
    await expect(
      resolveCurrentConversationNode(SESSION_ID, workspace('earlier', 'head')),
    ).resolves.toBe('earlier')
    expect(apiMock.getSessionWorkspace).not.toHaveBeenCalled()
  })

  it('reads the current head from the Host for a view at the loaded head', async () => {
    apiMock.getSessionWorkspace.mockResolvedValue(workspace('newer-head', 'newer-head'))

    await expect(
      resolveCurrentConversationNode(SESSION_ID, workspace('head', 'head')),
    ).resolves.toBe('newer-head')
    expect(apiMock.getSessionWorkspace).toHaveBeenCalledWith(SESSION_ID, { branchId: BRANCH_ID })
  })

  it('reads the current head from the Host when the view names no branch', async () => {
    apiMock.getSessionWorkspace.mockResolvedValue(workspace('newer-head', null))

    await expect(resolveCurrentConversationNode(SESSION_ID, workspace('head', null))).resolves.toBe(
      'newer-head',
    )
    expect(apiMock.getSessionWorkspace).toHaveBeenCalledWith(SESSION_ID, undefined)
  })
})
