import { SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionRepository } from '../../ports/session-repository'
import { registerSessionsHandlers } from '../sessions-handler'

const {
  typedHandleMock,
  listMock,
  listArchivedBranchesMock,
  getTreeMock,
  getWorkspaceMock,
  persistSnapshotMock,
  updateRuntimeMock,
  renameBranchMock,
  archiveBranchMock,
  restoreBranchMock,
  updateTreeUiStateMock,
} = vi.hoisted(() => ({
  typedHandleMock: vi.fn(),
  listMock: vi.fn(),
  listArchivedBranchesMock: vi.fn(),
  getTreeMock: vi.fn(),
  getWorkspaceMock: vi.fn(),
  persistSnapshotMock: vi.fn(),
  updateRuntimeMock: vi.fn(),
  renameBranchMock: vi.fn(),
  archiveBranchMock: vi.fn(),
  restoreBranchMock: vi.fn(),
  updateTreeUiStateMock: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
}))

vi.mock('../../application/agent-session-service', () => ({
  navigateAgentSessionTree: () => Effect.succeed({ cancelled: false }),
}))

const TestSessionRepositoryLayer = Layer.succeed(SessionRepository, {
  list: (limit) => Effect.sync(() => listMock(limit)),
  listArchivedBranches: (limit) => Effect.sync(() => listArchivedBranchesMock(limit)),
  getTree: (sessionId) => Effect.sync(() => getTreeMock(sessionId)),
  getWorkspace: (sessionId, selection) => Effect.sync(() => getWorkspaceMock(sessionId, selection)),
  persistSnapshot: (input) => Effect.sync(() => persistSnapshotMock(input)),
  updateRuntime: (input) => Effect.sync(() => updateRuntimeMock(input)),
  renameBranch: (sessionId, branchId, name) =>
    Effect.sync(() => renameBranchMock(sessionId, branchId, name)),
  archiveBranch: (sessionId, branchId) => Effect.sync(() => archiveBranchMock(sessionId, branchId)),
  restoreBranch: (sessionId, branchId) => Effect.sync(() => restoreBranchMock(sessionId, branchId)),
  updateTreeUiState: (sessionId, patch) =>
    Effect.sync(() => updateTreeUiStateMock(sessionId, patch)),
})

function requireTypedEffectInvokeHandler(name: string): (...args: unknown[]) => Promise<unknown> {
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === name && typeof candidate[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    throw new Error(`Missing typed handler: ${name}`)
  }

  return (...args: unknown[]) =>
    Effect.runPromise(Effect.provide(handler(...args), TestSessionRepositoryLayer))
}

describe('registerSessionsHandlers', () => {
  beforeEach(() => {
    typedHandleMock.mockReset()
    listMock.mockReset()
    listArchivedBranchesMock.mockReset()
    getTreeMock.mockReset()
    getWorkspaceMock.mockReset()
    persistSnapshotMock.mockReset()
    updateRuntimeMock.mockReset()
    renameBranchMock.mockReset()
    archiveBranchMock.mockReset()
    restoreBranchMock.mockReset()
    updateTreeUiStateMock.mockReset()
  })

  it('registers session branch and tree UI IPC channels', () => {
    registerSessionsHandlers()

    const channels = typedHandleMock.mock.calls
      .map((call) => (typeof call[0] === 'string' ? call[0] : ''))
      .filter(Boolean)

    expect(channels).toContain('sessions:rename-branch')
    expect(channels).toContain('sessions:archive-branch')
    expect(channels).toContain('sessions:restore-branch')
    expect(channels).toContain('sessions:update-tree-ui-state')
    expect(channels).toContain('sessions:list-archived-branches')
  })

  it('validates and dispatches branch rename requests', async () => {
    registerSessionsHandlers()
    const handler = requireTypedEffectInvokeHandler('sessions:rename-branch')

    await handler({}, SessionId('session-1'), SessionBranchId('branch-1'), '  Review path  ')

    expect(renameBranchMock).toHaveBeenCalledWith(
      SessionId('session-1'),
      SessionBranchId('branch-1'),
      'Review path',
    )
  })

  it('rejects empty branch names before dispatching rename', async () => {
    registerSessionsHandlers()
    const handler = requireTypedEffectInvokeHandler('sessions:rename-branch')

    await expect(
      handler({}, SessionId('session-1'), SessionBranchId('branch-1'), '  '),
    ).rejects.toThrow('Session branch name must be non-empty.')
    expect(renameBranchMock).not.toHaveBeenCalled()
  })

  it('validates and dispatches branch archive and restore requests', async () => {
    registerSessionsHandlers()
    const archiveHandler = requireTypedEffectInvokeHandler('sessions:archive-branch')
    const restoreHandler = requireTypedEffectInvokeHandler('sessions:restore-branch')

    await archiveHandler({}, SessionId('session-1'), SessionBranchId('branch-1'))
    await restoreHandler({}, SessionId('session-1'), SessionBranchId('branch-1'))

    expect(archiveBranchMock).toHaveBeenCalledWith(
      SessionId('session-1'),
      SessionBranchId('branch-1'),
    )
    expect(restoreBranchMock).toHaveBeenCalledWith(
      SessionId('session-1'),
      SessionBranchId('branch-1'),
    )
  })

  it('rejects missing branch IDs before dispatching branch mutations', async () => {
    registerSessionsHandlers()
    const archiveHandler = requireTypedEffectInvokeHandler('sessions:archive-branch')

    await expect(archiveHandler({}, SessionId('session-1'), '')).rejects.toThrow(
      'Session branch ID must be a non-empty string.',
    )
    expect(archiveBranchMock).not.toHaveBeenCalled()
  })

  it('validates and dispatches tree UI state patches', async () => {
    registerSessionsHandlers()
    const handler = requireTypedEffectInvokeHandler('sessions:update-tree-ui-state')

    await handler({}, SessionId('session-1'), {
      expandedNodeIds: [SessionNodeId('node-1')],
      branchesSidebarCollapsed: true,
    })

    expect(updateTreeUiStateMock).toHaveBeenCalledWith(SessionId('session-1'), {
      expandedNodeIds: [SessionNodeId('node-1')],
      branchesSidebarCollapsed: true,
    })
  })

  it('rejects empty tree UI state patches', async () => {
    registerSessionsHandlers()
    const handler = requireTypedEffectInvokeHandler('sessions:update-tree-ui-state')

    await expect(handler({}, SessionId('session-1'), {})).rejects.toThrow(
      'Session tree UI state patch must include at least one field.',
    )
    expect(updateTreeUiStateMock).not.toHaveBeenCalled()
  })

  it('rejects invalid expanded node IDs before dispatching tree UI state patches', async () => {
    registerSessionsHandlers()
    const handler = requireTypedEffectInvokeHandler('sessions:update-tree-ui-state')

    await expect(
      handler({}, SessionId('session-1'), { expandedNodeIds: [SessionNodeId('node-1'), ''] }),
    ).rejects.toThrow('Session node ID must be a non-empty string.')
    expect(updateTreeUiStateMock).not.toHaveBeenCalled()
  })
})
