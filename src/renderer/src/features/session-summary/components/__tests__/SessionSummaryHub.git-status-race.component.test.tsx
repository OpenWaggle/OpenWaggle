import { SessionId, WorkingPath } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { SessionSummaryHub } from '../SessionSummaryHub'

const listSessionResources = vi.hoisted(() => vi.fn())
const listArchivedSessions = vi.hoisted(() => vi.fn())
const listMcpEventSubscriptions = vi.hoisted(() => vi.fn())
const refreshStatus = vi.hoisted(() => vi.fn())
const useGit = vi.hoisted(() => vi.fn())
const useStackedGitActions = vi.hoisted(() => vi.fn())
const useCombinedVcsStatus = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listSessionResources,
    listArchivedSessions,
    listMcpEventSubscriptions,
  },
}))

vi.mock('@/features/git/hooks', () => ({ useGit }))

vi.mock('@/features/git/hooks/useStackedGitActions', () => ({ useStackedGitActions }))
vi.mock('@/features/git/hooks/useCombinedVcsStatus', () => ({ useCombinedVcsStatus }))

const ACTIVE_SESSION: SessionDetail = {
  id: SessionId('session-owner'),
  title: 'Session owner',
  projectPath: '/project',
  messages: [],
  environmentMode: 'local',
  createdAt: 1000,
  updatedAt: 1000,
}

describe('Session Summary Git status race', () => {
  beforeEach(() => {
    listSessionResources.mockReset().mockResolvedValue([])
    listArchivedSessions.mockReset().mockResolvedValue([])
    listMcpEventSubscriptions.mockReset().mockResolvedValue([])
    refreshStatus.mockReset().mockResolvedValue(undefined)
    useGit.mockReset().mockReturnValue({
      workingPath: WorkingPath('/project'),
      repositoryPath: '/project',
      status: null,
      isLoading: false,
      statusError: 'Detailed status failed.',
      error: 'Detailed status failed.',
      branches: null,
      isBranchActionRunning: false,
      refreshStatus,
      refreshBranches: vi.fn(),
      checkoutBranch: vi.fn(),
      createBranch: vi.fn(),
    })
    useStackedGitActions.mockReset().mockReturnValue({
      isRunning: false,
      progress: null,
      run: vi.fn(),
      cancel: vi.fn(),
    })
    useCombinedVcsStatus.mockReset().mockReturnValue({
      localState: 'loaded',
      remoteState: 'loaded',
      status: {
        isRepo: true,
        repositoryRoot: '/project',
        refName: 'feature/status-race',
        defaultRef: 'main',
        hasUncommittedChanges: true,
        hasWorkingTreeChanges: true,
        hasUpstream: true,
        aheadCount: 0,
        behindCount: 0,
        aheadOfDefaultCount: 1,
        sourceControlProvider: { id: 'github', label: 'GitHub' },
        changeRequest: null,
      },
      refresh: vi.fn(),
    })
  })

  it('shows a retryable status dialog when combined status enables the command first', () => {
    renderWithQueryClient(
      <SessionSummaryHub
        input={{
          session: ACTIVE_SESSION,
          messageCount: 1,
          autoHidden: false,
          rightSidebarOpen: false,
          onOpenDiff: vi.fn(),
          onOpenResources: vi.fn(),
          onNavigateSession: vi.fn(),
          extensionRegistry: null,
          extensionProjectPaths: ['/project'],
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Commit or push' }))

    expect(screen.getByRole('dialog', { name: 'Commit or push' })).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('Detailed status failed.')
    expect(refreshStatus).toHaveBeenCalledWith(WorkingPath('/project'))

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refreshStatus).toHaveBeenCalledTimes(2)
  })

  it('keeps the commit or push command available when remote status fails on a locally-ahead branch', () => {
    useGit.mockReturnValue({
      workingPath: WorkingPath('/project'),
      repositoryPath: '/project',
      status: {
        branch: 'feature/local-ahead',
        additions: 0,
        deletions: 0,
        filesChanged: 0,
        changedFiles: [],
        clean: true,
        ahead: 2,
        behind: 0,
      },
      isLoading: false,
      statusError: null,
      error: null,
      branches: null,
      isBranchActionRunning: false,
      refreshStatus,
      refreshBranches: vi.fn(),
      checkoutBranch: vi.fn(),
      createBranch: vi.fn(),
    })
    useCombinedVcsStatus.mockReturnValue({
      localState: 'loaded',
      remoteState: 'error',
      status: {
        isRepo: true,
        repositoryRoot: '/project',
        refName: 'feature/local-ahead',
        defaultRef: 'main',
        isDefaultRef: false,
        hasUncommittedChanges: false,
        hasWorkingTreeChanges: false,
        hasUpstream: false,
        aheadCount: 0,
        behindCount: 0,
        aheadOfDefaultCount: null,
        sourceControlProvider: { id: 'github', label: 'GitHub' },
        changeRequest: null,
      },
      refresh: vi.fn(),
    })

    renderWithQueryClient(
      <SessionSummaryHub
        input={{
          session: ACTIVE_SESSION,
          messageCount: 1,
          autoHidden: false,
          rightSidebarOpen: false,
          onOpenDiff: vi.fn(),
          onOpenResources: vi.fn(),
          onNavigateSession: vi.fn(),
          extensionRegistry: null,
          extensionProjectPaths: ['/project'],
        }}
      />,
    )

    const action = screen.getByRole('button', { name: 'Commit or push' })
    expect(action).not.toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(action)
    expect(screen.getByRole('dialog', { name: 'Commit or push' })).toBeVisible()
  })
})
