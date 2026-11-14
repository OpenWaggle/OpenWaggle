import type { ActionRun } from '@shared/types/action-runs'
import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { waitFor } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { usePreferencesStore } from '@/features/settings/state'
import { renderHookWithQueryClient, renderWithQueryClient } from '@/test-utils/query-test-utils'

const mocks = vi.hoisted(() => ({ manage: vi.fn() }))
vi.mock('@/shared/lib/ipc', () => ({ api: { manageProjectActions: mocks.manage } }))
vi.mock('@/features/git/hooks', () => ({ useGit: () => ({ workingPath: null }) }))
vi.mock('@/features/extensions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/extensions')>()),
  useExtensionSidePanelContributions: () => ({
    error: null,
    loading: false,
    projectPaths: [],
    refetch: vi.fn(),
    registry: null,
  }),
}))

import { ProjectActionsBackgroundEffects } from '@/features/project-actions'
import { useRightPanelModel } from '../useRightPanelModel'

const PROJECT_A = '/projects/a'
const PROJECT_B = '/projects/b'
const SESSION_B = SessionId('session-b')
const initialChat = useChatStore.getState()
const initialPreferences = usePreferencesStore.getState()

function runningRun(projectPath: string) {
  return fromPartial<ActionRun>({ id: `run-${projectPath}`, projectPath, status: 'running' })
}

function renderProjectActionsEntry() {
  return renderHookWithQueryClient(() => {
    const entry = useRightPanelModel(false).surfaces.find(
      (surface) => surface.id === 'project-actions',
    )
    return entry ? { running: entry.running, disabledReason: entry.disabledReason } : undefined
  })
}

beforeEach(() => {
  mocks.manage.mockReset()
  // Only project B has a running action; a request for A means the preference leaked in.
  mocks.manage.mockImplementation(
    async (request: { readonly scope: { readonly projectPath: string } }) => ({
      type: 'runs',
      runs: request.scope.projectPath === PROJECT_B ? [runningRun(PROJECT_B)] : [],
    }),
  )
  usePreferencesStore.setState({
    settings: { ...usePreferencesStore.getState().settings, projectPath: PROJECT_A },
  })
})

afterEach(() => {
  useChatStore.setState(initialChat, true)
  usePreferencesStore.setState(initialPreferences, true)
})

function openSessionB(loaded: boolean) {
  useChatStore.setState({
    activeSessionId: SESSION_B,
    activeSession: loaded
      ? fromPartial<SessionDetail>({ id: SESSION_B, projectPath: PROJECT_B })
      : null,
    draftSession: null,
  })
}

describe("Project Actions rail entry follows the open Session's project", () => {
  it('shows the running dot for the open Session while the preference is stale', async () => {
    openSessionB(true)
    const { result } = renderProjectActionsEntry()

    await waitFor(() => expect(result.current).toEqual({ running: true, disabledReason: null }))
    expect(
      mocks.manage.mock.calls.every(([request]) => request.scope.projectPath === PROJECT_B),
    ).toBe(true)
  })

  it('needs a project while the selected Session is unknown', () => {
    openSessionB(false)
    const { result } = renderProjectActionsEntry()

    expect(result.current).toEqual({ running: false, disabledReason: 'Open a project first' })
    expect(mocks.manage).not.toHaveBeenCalled()
  })
})

describe('ProjectActionsBackgroundEffects', () => {
  it("watches the open Session's runs, not the stale preference project", async () => {
    openSessionB(true)
    renderWithQueryClient(<ProjectActionsBackgroundEffects />)

    await waitFor(() => expect(mocks.manage).toHaveBeenCalled())
    expect(mocks.manage).toHaveBeenCalledWith({
      scope: { projectPath: PROJECT_B, sessionId: SESSION_B },
      operation: { type: 'runs' },
    })
    expect(
      mocks.manage.mock.calls.every(([request]) => request.scope.projectPath === PROJECT_B),
    ).toBe(true)
  })
})
