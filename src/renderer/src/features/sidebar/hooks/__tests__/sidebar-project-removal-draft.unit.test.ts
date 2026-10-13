import { SessionId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { carryRemovedSessionDraft, useComposerStore } from '@/features/composer/state'
import { usePreferencesStore } from '@/features/settings/state'
import {
  createSidebarProjectActions,
  type SidebarProjectActionDeps,
} from '../sidebar-project-actions'

const apiMocks = vi.hoisted(() => ({
  beginProjectRemoval: vi.fn(),
  cancelAgent: vi.fn(),
  closeBrowserPreview: vi.fn(),
  deleteSession: vi.fn(),
  getSessionDetail: vi.fn(),
  listActiveRuns: vi.fn(),
  listSessionsByIds: vi.fn(),
  querySessionControl: vi.fn(),
  showConfirm: vi.fn(),
  unregisterBrowserPreviewOwner: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMocks }))

const PROJECT_PATH = '/repo/project'
const SESSION = SessionId('kept-session')

/*
 * Removing a project deletes its Sessions with their drafts, which are not carried to the
 * project's New session once the Host reports them gone. A Session it could not delete stays,
 * and its draft is carried as any other's once the Host removes it.
 */
describe('Removing a project that could not delete a Session', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.beginProjectRemoval.mockResolvedValue(undefined)
    apiMocks.listActiveRuns.mockResolvedValue([])
    apiMocks.showConfirm.mockResolvedValue(true)
    apiMocks.querySessionControl.mockResolvedValue({
      contractVersion: 2,
      requestId: 'remove-project-sessions',
      outcome: {
        operation: 'list',
        sessions: [
          {
            sessionId: SESSION,
            title: 'Kept',
            projectPath: PROJECT_PATH,
            archived: false,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
    })
    apiMocks.listSessionsByIds.mockResolvedValue([
      { id: SESSION, title: 'Kept', projectPath: PROJECT_PATH, createdAt: 1, updatedAt: 1 },
    ])
    apiMocks.deleteSession.mockRejectedValue(new Error('The Session is busy'))
    // The Session is still there.
    apiMocks.getSessionDetail.mockResolvedValue({
      id: SESSION,
      title: 'Kept',
      projectPath: PROJECT_PATH,
      messages: [],
      createdAt: 1,
      updatedAt: 1,
    })
    usePreferencesStore.setState({ settings: { ...DEFAULT_SETTINGS, projectPath: PROJECT_PATH } })
    useComposerStore.setState(useComposerStore.getInitialState())
  })

  it('carries its draft once the Host removes it later', async () => {
    const deps = fromPartial<SidebarProjectActionDeps>({
      displayProjectName: () => 'Project',
      loadChatSessions: vi.fn().mockResolvedValue(undefined),
      loadSessionTrees: vi.fn().mockResolvedValue(undefined),
      showToast: vi.fn(),
    })

    createSidebarProjectActions(deps).remove(PROJECT_PATH)

    await vi.waitFor(() =>
      expect(deps.showToast).toHaveBeenCalledWith(
        expect.stringMatching(/^Failed to remove project: /),
      ),
    )
    useComposerStore
      .getState()
      .setActiveDraftContextKey(`project:${PROJECT_PATH}:session:${String(SESSION)}:main`)
    useComposerStore.getState().setInput('Keep this')
    carryRemovedSessionDraft(SESSION)
    expect(
      useComposerStore.getState().getScopedDraft(`project:${PROJECT_PATH}:new-session`)?.input,
    ).toBe('Keep this')
  })

  it('does not carry its draft while the removal finishes when the Host deleted it after all', async () => {
    apiMocks.getSessionDetail.mockResolvedValue(null)
    const carried: (string | undefined)[] = []
    useComposerStore
      .getState()
      .setActiveDraftContextKey(`project:${PROJECT_PATH}:session:${String(SESSION)}:main`)
    useComposerStore.getState().setInput('Gone with its project')
    const deps = fromPartial<SidebarProjectActionDeps>({
      displayProjectName: () => 'Project',
      // The Host reports the Session gone while the failed removal reloads the sidebar.
      loadChatSessions: vi.fn(async () => {
        carryRemovedSessionDraft(SESSION)
        carried.push(
          useComposerStore.getState().getScopedDraft(`project:${PROJECT_PATH}:new-session`)?.input,
        )
      }),
      loadSessionTrees: vi.fn().mockResolvedValue(undefined),
      showToast: vi.fn(),
    })

    createSidebarProjectActions(deps).remove(PROJECT_PATH)

    await vi.waitFor(() => expect(deps.showToast).toHaveBeenCalled())
    expect(carried).toEqual([undefined])
  })
})

describe('Removing a project', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.closeBrowserPreview.mockResolvedValue(undefined)
    apiMocks.unregisterBrowserPreviewOwner.mockResolvedValue(undefined)
    apiMocks.beginProjectRemoval.mockResolvedValue(undefined)
    apiMocks.listActiveRuns.mockResolvedValue([])
    apiMocks.showConfirm.mockResolvedValue(true)
    apiMocks.deleteSession.mockResolvedValue(undefined)
    let deleted = false
    apiMocks.deleteSession.mockImplementation(async () => {
      deleted = true
    })
    apiMocks.querySessionControl.mockImplementation(
      async (request: { readonly query: { readonly archived?: boolean } }) => ({
        contractVersion: 2,
        requestId: 'remove-project-sessions',
        outcome: {
          operation: 'list',
          sessions:
            deleted || request.query.archived
              ? []
              : [
                  {
                    sessionId: SESSION,
                    title: 'Closed',
                    projectPath: PROJECT_PATH,
                    archived: false,
                    createdAt: 1,
                    updatedAt: 1,
                  },
                ],
        },
      }),
    )
    apiMocks.listSessionsByIds.mockImplementation(async (ids: readonly string[]) =>
      ids.map((id) => ({
        id,
        title: 'Closed',
        projectPath: PROJECT_PATH,
        createdAt: 1,
        updatedAt: 1,
      })),
    )
    usePreferencesStore.setState({ settings: { ...DEFAULT_SETTINGS, projectPath: PROJECT_PATH } })
    useComposerStore.setState(useComposerStore.getInitialState())
  })

  it('forgets which drafts it would not carry once it is done', async () => {
    const deps = fromPartial<SidebarProjectActionDeps>({
      activeSessionId: null,
      displayProjectName: () => 'Project',
      loadChatSessions: vi.fn().mockResolvedValue(undefined),
      loadSessionTrees: vi.fn().mockResolvedValue(undefined),
      removeProjectReferences: vi.fn().mockResolvedValue(undefined),
      queryClient: fromPartial({ invalidateQueries: vi.fn().mockResolvedValue(undefined) }),
      showToast: vi.fn(),
    })

    createSidebarProjectActions(deps).remove(PROJECT_PATH)

    await vi.waitFor(() => expect(deps.removeProjectReferences).toHaveBeenCalled())
    await vi.waitFor(() => expect(deps.loadSessionTrees).toHaveBeenCalled())
    await Promise.resolve()
    // A Session that was not open is never carried; its id is not kept for it.
    useComposerStore
      .getState()
      .setActiveDraftContextKey(`project:${PROJECT_PATH}:session:${String(SESSION)}:main`)
    useComposerStore.getState().setInput('Another draft')
    carryRemovedSessionDraft(SESSION)
    expect(
      useComposerStore.getState().getScopedDraft(`project:${PROJECT_PATH}:new-session`)?.input,
    ).toBe('Another draft')
  })
})
