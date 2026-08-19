import { SessionId } from '@shared/types/brand'
import type { GitStatusSummary } from '@shared/types/git'
import type { SessionSummary } from '@shared/types/session'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGitStore } from '@/features/git'
import type { SidebarSessionActions } from '../../model'
import { SessionListItem } from '../SessionListItem'

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getGitStatus: vi.fn(),
    listGitBranches: vi.fn(),
    onGitWorkingTreeChanged: () => () => {},
  },
}))

const PROJECT = '/repo'
const WORKTREE_A = '/home/dev/.openwaggle/worktrees/repo/session-a'
const WORKTREE_B = '/home/dev/.openwaggle/worktrees/repo/session-b'

function status(overrides: Partial<GitStatusSummary> = {}): GitStatusSummary {
  return {
    branch: 'main',
    additions: 0,
    deletions: 0,
    filesChanged: 0,
    changedFiles: [],
    clean: true,
    ahead: 0,
    behind: 0,
    ...overrides,
  }
}

function session(id: string, extra: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: SessionId(id),
    title: `Session ${id}`,
    projectPath: PROJECT,
    createdAt: 1,
    updatedAt: 2,
    ...extra,
  }
}

// The real SidebarSessionActions shape. Renderer tests run with noCheck, so a
// made-up shape would compile and hand the component undefined callbacks.
function actions(): SidebarSessionActions {
  return {
    select: vi.fn(),
    delete: vi.fn(),
    archive: vi.fn(),
    markUnread: vi.fn(),
    togglePin: vi.fn(),
    clone: vi.fn(),
  }
}

function renderItem(target: SessionSummary) {
  return render(
    <ul>
      <SessionListItem session={target} isActive={false} actions={actions()} />
    </ul>,
  )
}

describe('SessionListItem git indicator', () => {
  beforeEach(() => {
    useGitStore.setState({ statusByWorkingPath: {} })
  })

  it('shows nothing while the session status is unknown', () => {
    renderItem(session('a', { environmentMode: 'worktree', worktreePath: WORKTREE_A }))

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('shows nothing for a clean synced tree', () => {
    useGitStore.setState({
      statusByWorkingPath: { [WORKTREE_A]: { status: status(), isLoading: false, error: null } },
    })

    renderItem(session('a', { environmentMode: 'worktree', worktreePath: WORKTREE_A }))

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('reports this session worktree divergence', () => {
    useGitStore.setState({
      statusByWorkingPath: {
        [WORKTREE_A]: {
          status: status({ clean: false, filesChanged: 3, ahead: 2 }),
          isLoading: false,
          error: null,
        },
      },
    })

    renderItem(session('a', { environmentMode: 'worktree', worktreePath: WORKTREE_A }))

    // Uncommitted files are deliberately not shown, only divergence. See ADR 0021.
    expect(screen.getByRole('img', { name: '2 commits ahead' })).toBeInTheDocument()
  })

  /**
   * The reason status is a map rather than one slot: two sessions in two worktrees
   * must each show their own state. With a single slot the second row rendered the
   * first row's status.
   */
  it('gives two sessions on two worktrees independent indicators', () => {
    useGitStore.setState({
      statusByWorkingPath: {
        [WORKTREE_A]: {
          status: status({ clean: false, filesChanged: 4, ahead: 4 }),
          isLoading: false,
          error: null,
        },
        [WORKTREE_B]: { status: status({ behind: 5 }), isLoading: false, error: null },
      },
    })

    const first = renderItem(
      session('a', { environmentMode: 'worktree', worktreePath: WORKTREE_A }),
    )
    expect(screen.getByRole('img', { name: '4 commits ahead' })).toBeInTheDocument()
    first.unmount()

    renderItem(session('b', { environmentMode: 'worktree', worktreePath: WORKTREE_B }))
    expect(screen.getByRole('img', { name: '5 commits behind' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: '4 commits ahead' })).not.toBeInTheDocument()
  })

  // A local-mode session reads the opened checkout, not a worktree path it may carry
  // from a previous mode change.
  it('reads the project path for a local-mode session', () => {
    useGitStore.setState({
      statusByWorkingPath: {
        [PROJECT]: {
          status: status({ clean: false, filesChanged: 1, ahead: 1 }),
          isLoading: false,
          error: null,
        },
        [WORKTREE_A]: {
          status: status({ clean: false, filesChanged: 9, ahead: 9 }),
          isLoading: false,
          error: null,
        },
      },
    })

    renderItem(session('a', { environmentMode: 'local', worktreePath: WORKTREE_A }))

    expect(screen.getByRole('img', { name: '1 commit ahead' })).toBeInTheDocument()
  })
})
