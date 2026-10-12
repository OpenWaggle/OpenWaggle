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
})
