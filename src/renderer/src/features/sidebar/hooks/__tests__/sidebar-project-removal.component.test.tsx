import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSidebarProjectActions } from '../sidebar-project-actions'

/** Removing a project keeps discovered Pi sessions listable if the folder is added back. */
const REMOVING_PROJECT = { removingProject: true }

const api = vi.hoisted(() => ({
  querySessionControl: vi.fn(),
  listSessionsByIds: vi.fn(),
  listActiveRuns: vi.fn(),
  cancelAgent: vi.fn(),
  deleteSession: vi.fn(),
  beginProjectRemoval: vi.fn(),
  showConfirm: vi.fn(),
}))
vi.mock('@/shared/lib/ipc', () => ({ api }))
vi.mock('@/shell/workspace-panel-cleanup', () => ({
  deleteWorkspaceOwner: vi.fn(async () => undefined),
  archiveWorkspaceOwner: vi.fn(async () => undefined),
}))

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
    setProjectDisplayName: vi.fn(async () => undefined),
    setProjectPath: vi.fn(async () => undefined),
    showToast: vi.fn(),
    startDraftSession: vi.fn(),
    clearActiveSession: vi.fn(),
    getActiveSessionId: () => null,
    clearTransientDraftContext: vi.fn(),
  } satisfies Parameters<typeof createSidebarProjectActions>[0]
  return { deps, actions: createSidebarProjectActions(deps) }
}

let listedIds: string[]

function installSessionCatalog() {
  api.querySessionControl.mockImplementation(
    async (request: { query: { archived?: boolean } }) => ({
      outcome: {
        operation: 'list',
        sessions: request.query.archived ? [] : listedIds.map((id) => ({ sessionId: id })),
      },
    }),
  )
  api.listSessionsByIds.mockImplementation(async (ids: readonly SessionId[]) =>
    ids.map((id) => session(String(id))),
  )
}

describe('project removal preflight and failure recovery', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    listedIds = ['first', 'second', 'third']
    installSessionCatalog()
    api.listActiveRuns.mockResolvedValue([])
    api.deleteSession.mockImplementation(async (id: SessionId) => {
      listedIds = listedIds.filter((listed) => listed !== String(id))
    })
    api.beginProjectRemoval.mockResolvedValue(undefined)
    api.showConfirm.mockResolvedValue(true)
  })

  it('stops Pi session discovery for the project before reading the Sessions it deletes', async () => {
    const { deps, actions } = setup()
    actions.remove('/project')
    await vi.waitFor(() => expect(deps.removeProjectReferences).toHaveBeenCalledWith('/project'))

    expect(api.beginProjectRemoval).toHaveBeenCalledWith('/project')
    // The first listing (active, then archived) counts the Sessions for the confirmation; the
    // second picks what to delete.
    const deletionListing = api.querySessionControl.mock.invocationCallOrder[2]
    expect(api.beginProjectRemoval.mock.invocationCallOrder[0]).toBeLessThan(deletionListing ?? 0)
  })

  it('keeps the project when a Session was added to it during the removal', async () => {
    const { deps, actions } = setup()
    api.deleteSession.mockImplementation(async (id: SessionId) => {
      listedIds = [...listedIds.filter((listed) => listed !== String(id)), 'added']
      listedIds = [...new Set(listedIds)]
    })
    actions.remove('/project')
    await vi.waitFor(() =>
      expect(deps.showToast).toHaveBeenCalledWith(
        expect.stringContaining('Sessions were added to the project'),
      ),
    )
    expect(api.deleteSession).not.toHaveBeenCalledWith(SessionId('added'), REMOVING_PROJECT)
    expect(deps.removeProjectReferences).not.toHaveBeenCalled()
  })

  it('requires new confirmation when the project session set changes', async () => {
    const { deps, actions } = setup()
    api.showConfirm.mockImplementationOnce(async () => {
      listedIds = ['first', 'second', 'new']
      return true
    })
    actions.remove('/project')
    await vi.waitFor(() =>
      expect(deps.showToast).toHaveBeenCalledWith(
        expect.stringContaining('Project sessions changed'),
      ),
    )
    expect(api.deleteSession).not.toHaveBeenCalled()
    expect(deps.removeProjectReferences).not.toHaveBeenCalled()
    expect(deps.loadChatSessions).toHaveBeenCalled()
    expect(deps.loadSessionTrees).toHaveBeenCalled()

    actions.remove('/project')
    await vi.waitFor(() => expect(deps.removeProjectReferences).toHaveBeenCalledWith('/project'))
    expect(api.deleteSession.mock.calls).toEqual([
      [SessionId('first'), REMOVING_PROJECT],
      [SessionId('second'), REMOVING_PROJECT],
      [SessionId('new'), REMOVING_PROJECT],
    ])
  })

  it('does not delete anything when fresh eligibility cannot be read', async () => {
    const { deps, actions } = setup()
    api.showConfirm.mockImplementationOnce(async () => {
      api.querySessionControl.mockRejectedValue(new Error('Catalog unavailable'))
      return true
    })
    actions.remove('/project')
    await vi.waitFor(() =>
      expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('Catalog unavailable')),
    )
    expect(api.deleteSession).not.toHaveBeenCalled()
    expect(deps.removeProjectReferences).not.toHaveBeenCalled()
  })

  it('stops on a late rejection and refreshes stores before reporting it', async () => {
    const { deps, actions } = setup()
    api.deleteSession.mockReset()
    api.deleteSession
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Now active'))
    actions.remove('/project')
    await vi.waitFor(() =>
      expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('Now active')),
    )
    expect(api.deleteSession.mock.calls).toEqual([
      [SessionId('first'), REMOVING_PROJECT],
      [SessionId('second'), REMOVING_PROJECT],
    ])
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
