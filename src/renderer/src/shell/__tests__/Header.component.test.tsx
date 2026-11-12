import { SessionBranchId, SessionId, WorkingPath } from '@shared/types/brand'
import type { GitStatusSummary } from '@shared/types/git'
import type { SessionDetail, SessionLineageSummary, SessionSummary } from '@shared/types/session'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { useGitStore } from '@/features/git/state'
import { useSessionSummaryUIStore } from '@/features/session-summary'
import { useSessionStore } from '@/features/sessions/state'
import { useTerminalStore } from '@/features/terminal'
import { registerRightPanelController } from '@/shared/lib/right-panel-surfaces'
import { Header } from '../Header'
import { useUIStore } from '../ui-store'
import { resetWorkspaceShellStores } from './workspace-shell.test-harness'
import { renderAtRoute } from './workspace-shell-render.test-harness'

/*
 * Only the preload is replaced: the chat, Session, git, terminal and Session Summary stores, the
 * commit dialog and a memory router are the real ones, so each case asserts what the header shows
 * and what it asks the Host for.
 */
const PROJECT = '/repo/openwaggle'
const WORKTREE = '/wt/openwaggle/session-1'
const SESSION_ID = SessionId('session-1')

const mocks = vi.hoisted(() => ({
  getGitStatus: vi.fn(),
  listGitBranches: vi.fn(async () => []),
  commitGit: vi.fn(async () => ({ ok: true, commitHash: 'abc123', summary: 'abc123' })),
}))
vi.mock('@/shared/lib/ipc', async () => ({
  api: (await import('@/test-utils/preload-api')).preloadApi(mocks),
}))

const GIT_STATUS: GitStatusSummary = {
  branch: 'feat/actual-checkout',
  additions: 3,
  deletions: 1,
  filesChanged: 1,
  changedFiles: [
    {
      path: 'src/app.ts',
      status: 'modified',
      staged: false,
      unstaged: true,
      additions: 3,
      deletions: 1,
    },
  ],
  clean: false,
  ahead: 0,
  behind: 0,
}

const QUEEN: SessionLineageSummary = {
  role: 'queen',
  directWorkerCount: 2,
  activeDirectWorkerCount: 1,
  agentDefinitionName: 'release-lead',
}
const WORKER: SessionLineageSummary = {
  role: 'worker',
  parentSessionId: SessionId('session-parent'),
  hiveRootSessionId: SessionId('session-parent'),
  directWorkerCount: 0,
  activeDirectWorkerCount: 0,
  agentDefinitionName: 'release-lead',
}
const INDEPENDENT: SessionLineageSummary = {
  role: 'independent',
  directWorkerCount: 0,
  activeDirectWorkerCount: 0,
  agentDefinitionName: 'security-reviewer',
}

const ACTIVE_SESSION: SessionDetail = {
  id: SESSION_ID,
  title: 'Fallback title',
  messages: [],
  projectPath: PROJECT,
  createdAt: 1,
  updatedAt: 2,
  environmentMode: 'worktree',
  worktreePath: WORKTREE,
}

function summary(id: string, title: string, lineage: SessionLineageSummary): SessionSummary {
  return {
    id: SessionId(id),
    title,
    projectPath: PROJECT,
    createdAt: 1,
    updatedAt: 2,
    lastActiveBranchId: SessionBranchId('branch-1'),
    lineage,
  }
}

function tree(session: SessionSummary) {
  return {
    session,
    branches: [
      {
        id: SessionBranchId('branch-1'),
        sessionId: session.id,
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
  }
}

/** Where the selected Session's summary is known from: the catalog page, archive, or its tree. */
function showSession(
  lineage: SessionLineageSummary,
  known: { readonly catalog?: 'live' | 'archived'; readonly tree?: 'current' | 'previous' },
) {
  const session = summary('session-1', 'Session title', lineage)
  useSessionStore.setState({
    sessions: known.catalog === 'live' ? [session] : [],
    archivedSessions: known.catalog === 'archived' ? [session] : [],
    activeSessionTree:
      known.tree === 'current'
        ? tree(session)
        : known.tree === 'previous'
          ? tree(summary('session-previous', 'Previous session', lineage))
          : null,
  })
}

function renderHeader() {
  return renderAtRoute(<Header />)
}

function resetStores() {
  resetWorkspaceShellStores(PROJECT)
  useGitStore.setState(useGitStore.getInitialState(), true)
  useSessionSummaryUIStore.setState({ panels: {}, toggleFocusTargetSessionId: null })
}

describe('Header', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.getGitStatus.mockResolvedValue(GIT_STATUS)
    resetStores()
    useChatStore.setState({ activeSessionId: SESSION_ID, activeSession: ACTIVE_SESSION })
    useSessionSummaryUIStore.getState().syncPanel('session-1', {
      available: true,
      autoHidden: false,
      rightSidebarOpen: false,
    })
    await useGitStore.getState().refreshStatus(WorkingPath(WORKTREE))
  })
  afterEach(resetStores)

  // ADR 0036: the tree refreshes after a switch, and reading it first titled the new transcript
  // with the previous Session's name.
  it('never shows the previous Session title while the new Session tree loads', async () => {
    showSession(QUEEN, { tree: 'previous' })
    await renderHeader()

    expect(screen.queryByText('Previous session')).not.toBeInTheDocument()
    expect(screen.getByText('Fallback title')).toBeInTheDocument()
  })

  it('renders session/project context and wires app-level controls', async () => {
    showSession(QUEEN, { catalog: 'live', tree: 'current' })
    const controller = {
      toggleSurface: vi.fn(),
      showSurface: vi.fn(),
      togglePanel: vi.fn(),
      closePanel: vi.fn(),
    }
    const unregister = registerRightPanelController(controller)
    await renderHeader()

    expect(screen.getByText('Session title')).toBeInTheDocument()
    expect(screen.getByText('Queen')).toBeInTheDocument()
    expect(screen.getByText('release-lead')).toBeInTheDocument()
    expect(screen.getByText('/ feat/actual-checkout')).toBeInTheDocument()
    expect(screen.getByText('openwaggle')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open terminal' })).toHaveAttribute(
      'title',
      'Open session terminal (Ctrl + J)',
    )
    expect(screen.getByRole('button', { name: 'Open terminal' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+J',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open terminal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide Session Summary' }))
    // ADR 0043: Session Tree lives on the Panel rail; the Changes readout opens Changes there.
    expect(screen.queryByRole('button', { name: 'Toggle Session Tree' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Changes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show right panel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Report a bug' }))

    expect(useSessionSummaryUIStore.getState().panels['session-1']?.expanded).toBe(false)
    expect(useTerminalStore.getState().groups['session-1']?.panelOpen).toBe(true)
    expect(useUIStore.getState().feedbackModalOpen).toBe(true)
    // The right panel host registers this controller in the app; it stands in for that host.
    expect(controller.toggleSurface).toHaveBeenCalledWith('changes')
    expect(controller.togglePanel).toHaveBeenCalledOnce()
    unregister()

    fireEvent.click(screen.getByRole('button', { name: 'Open commit dialog' }))
    const dialog = await screen.findByRole('dialog', { name: 'Commit changes' })
    mocks.getGitStatus.mockClear()
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }))
    // Manual refresh reads the session's working tree, and branches from the repository.
    await waitFor(() => expect(mocks.getGitStatus).toHaveBeenCalledWith(WORKTREE))
    expect(mocks.listGitBranches).toHaveBeenCalledWith(PROJECT)
    fireEvent.change(screen.getByPlaceholderText('Describe your changes'), {
      target: { value: 'Ship it' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }))

    // Commit writes to the tree being reviewed, not the opened checkout.
    await waitFor(() =>
      expect(mocks.commitGit).toHaveBeenCalledWith(WORKTREE, {
        sessionId: SESSION_ID,
        message: 'Ship it',
        amend: false,
        paths: ['src/app.ts'],
      }),
    )
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(useUIStore.getState().diffRefreshKey).toBe(2)
    expect(useUIStore.getState().toastData?.message).toBe('Commit created: abc123')
  })

  it.each([
    ['an archived Session', QUEEN, { catalog: 'archived' }, ['Queen', 'release-lead']],
    [
      'an archived independent Session',
      INDEPENDENT,
      { catalog: 'archived' },
      ['security-reviewer'],
    ],
    ['a Session outside the bounded catalog page', QUEEN, { tree: 'current' }, ['Queen']],
    ['a Worker outside the bounded catalog page', WORKER, { tree: 'current' }, ['Worker']],
    [
      'an independent Session outside the bounded catalog page',
      INDEPENDENT,
      { tree: 'current' },
      ['security-reviewer'],
    ],
  ] as const)('keeps the identity of %s visible', async (_case, lineage, known, shown) => {
    showSession(lineage, known)
    await renderHeader()

    for (const text of shown) expect(screen.getByText(text)).toBeInTheDocument()
    if (lineage.role === 'independent') {
      expect(screen.queryByText('Queen')).not.toBeInTheDocument()
      expect(screen.queryByText('Worker')).not.toBeInTheDocument()
    } else {
      expect(screen.getByText('release-lead')).toBeInTheDocument()
    }
  })
})
