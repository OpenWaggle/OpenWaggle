import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSidebarProjectActions } from '../sidebar-project-actions'

const api = vi.hoisted(() => ({
  listArchivedSessions: vi.fn(),
  listSessions: vi.fn(),
  deleteSession: vi.fn(),
  showConfirm: vi.fn(),
  closeBrowserPreview: vi.fn(),
  unregisterBrowserPreviewOwner: vi.fn(),
}))
vi.mock('@/shared/lib/ipc', () => ({ api }))

function session(id: string): SessionSummary {
  return { id: SessionId(id), title: id, projectPath: '/project', createdAt: 1, updatedAt: 1 }
}

function setup() {
  const deps = {
    activeSessionId: null,
    displayProjectName: () => 'Project',
    expandProject: vi.fn(),
    loadChatSessions: vi.fn(async () => undefined),
    loadSessionTrees: vi.fn(async () => undefined),
    navigate: vi.fn(async () => undefined),
    projectPath: '/project',
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    refreshGit: vi.fn(),
    removeProjectReferences: vi.fn(async () => undefined),
    selectFolder: vi.fn(async () => null),
    sessions: [session('first'), session('second'), session('third')],
    setProjectDisplayName: vi.fn(async () => undefined),
    setProjectPath: vi.fn(async () => undefined),
    showToast: vi.fn(),
    startDraftSession: vi.fn(),
    clearTransientDraftContext: vi.fn(),
  } satisfies Parameters<typeof createSidebarProjectActions>[0]
  return { deps, actions: createSidebarProjectActions(deps) }
}

describe('project removal preflight and failure recovery', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    api.listArchivedSessions.mockResolvedValue([])
    api.listSessions.mockResolvedValue([session('first'), session('second'), session('third')])
    api.deleteSession.mockResolvedValue(undefined)
    api.showConfirm.mockResolvedValue(true)
    api.closeBrowserPreview.mockResolvedValue(undefined)
    api.unregisterBrowserPreviewOwner.mockResolvedValue(undefined)
  })

  it('requires new confirmation when the project session set changes', async () => {
    const { deps, actions } = setup()
    api.listSessions.mockResolvedValue([session('first'), session('second'), session('new')])
    actions.remove('/project')
    await vi.waitFor(() =>
      expect(deps.showToast).toHaveBeenCalledWith(
        expect.stringContaining('Project sessions changed'),
      ),
    )
    expect(api.deleteSession).not.toHaveBeenCalled()
    expect(deps.removeProjectReferences).not.toHaveBeenCalled()
    expect(api.unregisterBrowserPreviewOwner).not.toHaveBeenCalled()
    expect(deps.loadChatSessions).toHaveBeenCalled()
    expect(deps.loadSessionTrees).toHaveBeenCalled()
    const refreshed = { ...deps, sessions: [session('first'), session('second'), session('new')] }
    createSidebarProjectActions(refreshed).remove('/project')
    await vi.waitFor(() => expect(deps.removeProjectReferences).toHaveBeenCalledWith('/project'))
    expect(api.deleteSession.mock.calls).toEqual([
      [SessionId('first')],
      [SessionId('second')],
      [SessionId('new')],
    ])
    expect(api.unregisterBrowserPreviewOwner.mock.calls).toEqual([['first'], ['second'], ['new']])
  })

  it('does not delete anything when fresh eligibility cannot be read', async () => {
    const { deps, actions } = setup()
    api.listSessions.mockRejectedValue(new Error('Catalog unavailable'))
    actions.remove('/project')
    await vi.waitFor(() =>
      expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('Catalog unavailable')),
    )
    expect(api.deleteSession).not.toHaveBeenCalled()
    expect(deps.removeProjectReferences).not.toHaveBeenCalled()
  })

  it('stops on a late rejection and refreshes stores before reporting it', async () => {
    const { deps, actions } = setup()
    api.deleteSession
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Now active'))
    actions.remove('/project')
    await vi.waitFor(() =>
      expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('Now active')),
    )
    expect(api.deleteSession.mock.calls).toEqual([[SessionId('first')], [SessionId('second')]])
    expect(deps.loadChatSessions).toHaveBeenCalled()
    expect(deps.loadSessionTrees).toHaveBeenCalled()
    expect(deps.removeProjectReferences).not.toHaveBeenCalled()
    expect(deps.startDraftSession).not.toHaveBeenCalled()
  })

  it('preserves the deletion error when recovery also fails', async () => {
    const { deps, actions } = setup()
    api.deleteSession.mockRejectedValue(new Error('Now active'))
    deps.loadChatSessions.mockRejectedValue(new Error('Reload unavailable'))
    actions.remove('/project')
    await vi.waitFor(() =>
      expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('Now active')),
    )
  })
})
