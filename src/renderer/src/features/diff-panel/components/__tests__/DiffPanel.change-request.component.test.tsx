import { RepositoryPath, SessionId, WorkingPath } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGitStore } from '@/features/git'
import { usePreferencesStore } from '@/features/settings/state'
import { rendererQueryClient } from '@/queries/query-client'
import { api } from '@/shared/lib/ipc'
import { useDiffScopeStore } from '../../state/diff-scope-store'
import { DiffPanel } from '../DiffPanel'
import { gitStatus } from './diff-panel.test-harness'

vi.mock('@pierre/diffs/react', async () => ({
  CodeView: (await import('./diff-panel.test-harness')).StubCodeView,
  WorkerPoolContextProvider: (await import('./diff-panel.test-harness'))
    .StubWorkerPoolContextProvider,
  useWorkerPool: () => undefined,
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getGitDiff: vi.fn(),
    getGitBranchDiff: vi.fn(),
    getGitStatus: vi.fn(),
    listGitBranches: vi.fn(),
    getLocalVcsStatus: vi.fn(),
    getRemoteVcsStatus: vi.fn(),
    getChangeRequestOpenDestination: vi.fn(),
    listTurnCheckpoints: vi.fn(),
    openExternal: vi.fn(),
  },
}))

const WORKING_PATH = WorkingPath('/repo')
const REQUEST_URL = 'https://github.com/o/r/pull/7'

function renderPanel(onOpenChangeRequest: ((url: string) => void) | null = vi.fn()) {
  render(
    <DiffPanel
      session={{
        id: SessionId('session-a'),
        title: 'Session',
        projectPath: '/repo',
        messages: [],
        environmentMode: 'local',
        createdAt: 1,
        updatedAt: 1,
      }}
      sessionId={SessionId('session-a')}
      workingPath={WORKING_PATH}
      repositoryPath={RepositoryPath('/repo')}
      onSendMessage={vi.fn()}
      {...(onOpenChangeRequest ? { onOpenChangeRequest } : {})}
    />,
  )
  return onOpenChangeRequest
}

describe('DiffPanel change request', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    rendererQueryClient.clear()
    usePreferencesStore.setState({
      settings: { ...DEFAULT_SETTINGS, browserLinkTarget: 'system' },
      isLoaded: true,
    })
    useGitStore.setState({
      statusByWorkingPath: {
        [WORKING_PATH]: { status: gitStatus([]), isLoading: false, error: null },
      },
    })
    useDiffScopeStore.setState({ byThreadKey: {} })
    vi.mocked(api.getGitDiff).mockResolvedValue({ ok: true, files: [] })
    vi.mocked(api.getGitStatus).mockResolvedValue(gitStatus([]))
    vi.mocked(api.listGitBranches).mockResolvedValue({ currentBranch: 'feature/x', branches: [] })
    vi.mocked(api.openExternal).mockResolvedValue(undefined)
    vi.mocked(api.listTurnCheckpoints).mockResolvedValue([])
    vi.mocked(api.getLocalVcsStatus).mockResolvedValue({
      ok: true,
      status: {
        isRepo: true,
        sourceControlProvider: { id: 'github', host: 'github.com' },
        sourceControlHost: { host: 'github.com', provider: 'github', source: 'public-host' },
        sourceControlAttention: null,
        sourceControlRepositoryUrl: 'https://github.com/o/r',
        hasPrimaryRemote: true,
        isDefaultRef: false,
        pushTargetRef: 'feature/x',
        pushTargetIsDefaultRef: false,
        refName: 'feature/x',
        hasWorkingTreeChanges: false,
        workingTree: { files: [], insertions: 0, deletions: 0 },
      },
    })
    vi.mocked(api.getRemoteVcsStatus).mockResolvedValue({
      ok: true,
      status: {
        hasUpstream: true,
        aheadCount: 0,
        behindCount: 0,
        aheadOfDefaultCount: 1,
        changeRequest: {
          title: 'Lifecycle',
          url: REQUEST_URL,
          baseRef: 'main',
          headRef: 'feature/x',
          state: 'open',
        },
        changeRequestAttention: null,
        changeRequestAccount: null,
      },
    })
  })

  it('opens the existing request in the inspector by default', async () => {
    vi.mocked(api.getChangeRequestOpenDestination).mockResolvedValue({
      destination: 'inspector',
      source: 'default',
    })
    const onOpenChangeRequest = renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'View PR' }))

    await waitFor(() => expect(onOpenChangeRequest).toHaveBeenCalledWith(REQUEST_URL))
    expect(api.getChangeRequestOpenDestination).toHaveBeenCalledWith('/repo')
    expect(api.openExternal).not.toHaveBeenCalled()
  })

  it('opens the provider website when that is the destination', async () => {
    vi.mocked(api.getChangeRequestOpenDestination).mockResolvedValue({
      destination: 'website',
      source: 'user',
    })
    const onOpenChangeRequest = renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'View PR' }))

    await waitFor(() => expect(api.openExternal).toHaveBeenCalledWith(REQUEST_URL))
    expect(onOpenChangeRequest).not.toHaveBeenCalled()
  })

  it('falls back to the provider website when the destination cannot be read', async () => {
    vi.mocked(api.getChangeRequestOpenDestination).mockRejectedValue(new Error('Host too old'))
    const onOpenChangeRequest = renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: 'View PR' }))

    await waitFor(() => expect(api.openExternal).toHaveBeenCalledWith(REQUEST_URL))
    expect(onOpenChangeRequest).not.toHaveBeenCalled()
  })

  it('opens the provider website when no inspector is available', async () => {
    vi.mocked(api.getChangeRequestOpenDestination).mockResolvedValue({
      destination: 'inspector',
      source: 'default',
    })
    renderPanel(null)

    fireEvent.click(await screen.findByRole('button', { name: 'View PR' }))

    await waitFor(() => expect(api.openExternal).toHaveBeenCalledWith(REQUEST_URL))
  })
})
