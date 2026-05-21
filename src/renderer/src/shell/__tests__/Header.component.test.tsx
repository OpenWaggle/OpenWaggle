import { SessionBranchId, SessionId } from '@shared/types/brand'
import type { GitCommitResult, GitStatusSummary } from '@shared/types/git'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Button } from '@/shared/ui/Button'
import { Header } from '../Header'
import { useUIStore } from '../ui-store'

interface CommitDialogProps {
  readonly onClose: () => void
  readonly onCommit: (message: string, amend: boolean, paths: string[]) => Promise<GitCommitResult>
  readonly onRefresh: () => void
}

const headerMocks = vi.hoisted(() => {
  const gitStatus: GitStatusSummary = {
    branch: 'main',
    additions: 3,
    deletions: 1,
    filesChanged: 2,
    changedFiles: [],
    clean: false,
    ahead: 0,
    behind: 0,
  }
  return {
    projectPath: '/repo/openwaggle',
    gitStatus,
    refreshStatus: vi.fn().mockResolvedValue(undefined),
    refreshBranches: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue({ ok: true, commitHash: 'abc123', summary: 'abc123' }),
    toggleDiff: vi.fn(),
    toggleSessionTree: vi.fn(),
  }
})

vi.mock('@/features/chat/hooks', () => ({
  useChat: () => ({ activeSession: { title: 'Fallback title' } }),
}))

vi.mock('@/features/diff-panel/hooks', () => ({
  useDiffRouteNavigation: () => ({
    diffOpen: false,
    isChatRoute: true,
    sessionTreeOpen: false,
    toggleDiff: headerMocks.toggleDiff,
    toggleSessionTree: headerMocks.toggleSessionTree,
  }),
}))

vi.mock('@/features/git/components', () => ({
  CommitDialog: ({ onClose, onCommit, onRefresh }: CommitDialogProps) => (
    <section>
      Commit dialog
      <Button variant="unstyled" type="button" onClick={onRefresh}>
        Refresh git
      </Button>
      <Button
        variant="unstyled"
        type="button"
        onClick={() => void onCommit('Ship it', false, ['src/app.ts'])}
      >
        Confirm commit
      </Button>
      <Button variant="unstyled" type="button" onClick={onClose}>
        Close commit
      </Button>
    </section>
  ),
}))

vi.mock('@/features/git/hooks', () => ({
  useGit: () => ({
    status: headerMocks.gitStatus,
    error: null,
    isLoading: false,
    isCommitting: false,
    refreshStatus: headerMocks.refreshStatus,
    refreshBranches: headerMocks.refreshBranches,
    commit: headerMocks.commit,
  }),
}))

vi.mock('@/features/sessions/hooks', () => ({
  useProject: () => ({ projectPath: headerMocks.projectPath }),
  useSessions: () => ({
    activeSessionTree: {
      session: {
        id: SessionId('session-1'),
        title: 'Session title',
        projectPath: headerMocks.projectPath,
        createdAt: 1,
        updatedAt: 2,
        lastActiveBranchId: SessionBranchId('branch-1'),
      },
      branches: [
        {
          id: SessionBranchId('branch-1'),
          sessionId: SessionId('session-1'),
          sourceNodeId: null,
          headNodeId: null,
          name: 'feature/test-branch',
          isMain: true,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      nodes: [],
      branchStates: [],
      uiState: null,
    },
  }),
}))

describe('Header', () => {
  beforeEach(() => {
    useUIStore.setState({
      diffRefreshKey: 0,
      feedbackModalOpen: false,
      sidebarOpen: true,
      terminalOpen: false,
      toastData: null,
      toastMessage: null,
    })
    headerMocks.refreshStatus.mockClear()
    headerMocks.refreshBranches.mockClear()
    headerMocks.commit.mockClear()
    headerMocks.toggleDiff.mockClear()
    headerMocks.toggleSessionTree.mockClear()
  })

  it('renders session/project context and wires app-level controls', async () => {
    render(<Header />)

    expect(screen.getByText('Session title')).toBeInTheDocument()
    expect(screen.getByText('/ feature/test-branch')).toBeInTheDocument()
    expect(screen.getByText('openwaggle')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open terminal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Toggle Session Tree' }))
    fireEvent.click(screen.getByRole('button', { name: 'Toggle diff panel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Report a bug' }))

    expect(useUIStore.getState().terminalOpen).toBe(true)
    expect(useUIStore.getState().feedbackModalOpen).toBe(true)
    expect(headerMocks.toggleSessionTree).toHaveBeenCalledOnce()
    expect(headerMocks.toggleDiff).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Open commit dialog' }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh git' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm commit' }))

    expect(screen.getByText('Commit dialog')).toBeInTheDocument()
    expect(headerMocks.refreshStatus).toHaveBeenCalledWith('/repo/openwaggle')
    expect(headerMocks.refreshBranches).toHaveBeenCalledWith('/repo/openwaggle')
    await waitFor(() =>
      expect(headerMocks.commit).toHaveBeenCalledWith('/repo/openwaggle', {
        message: 'Ship it',
        amend: false,
        paths: ['src/app.ts'],
      }),
    )
    expect(useUIStore.getState().diffRefreshKey).toBe(2)
    expect(useUIStore.getState().toastData?.message).toBe('Commit created: abc123')
  })
})
