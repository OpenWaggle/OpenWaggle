import { SessionBranchId, SessionId } from '@shared/types/brand'
import type { GitStatusSummary } from '@shared/types/git'
import type { SessionBranch, SessionSummary } from '@shared/types/session'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGitStore } from '@/features/git'
import { useSessionStatusStore } from '@/features/sessions/state'
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
const WORKTREE = '/home/dev/.openwaggle/worktrees/repo/session-a'
const SESSION_ID = SessionId('session-a')
const TITLE = 'Sidebar remodel with a fairly long session title'

const qa = (name: string) => [...document.querySelectorAll(`[data-qa="${name}"]`)]
const qaOne = (name: string) => document.querySelector(`[data-qa="${name}"]`)

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

function branch(id: string, overrides: Partial<SessionBranch> = {}): SessionBranch {
  return {
    id: SessionBranchId(id),
    sessionId: SESSION_ID,
    sourceNodeId: null,
    headNodeId: null,
    name: id,
    isMain: id === 'main',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

function session(extra: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: SESSION_ID,
    title: TITLE,
    projectPath: PROJECT,
    createdAt: 1,
    updatedAt: Date.now() - 4 * 60 * 60 * 1000,
    ...extra,
  }
}

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

function renderRow(target: SessionSummary = session(), extra: Record<string, unknown> = {}) {
  return render(
    <ul>
      <SessionListItem session={target} isActive={false} actions={actions()} {...extra} />
    </ul>,
  )
}

describe('two-line session row', () => {
  beforeEach(() => {
    useGitStore.setState({ statusByWorkingPath: {} })
    useSessionStatusStore.setState({
      statuses: new Map(),
      completedAt: new Map(),
      lastVisitedAt: new Map(),
      phases: new Map(),
    })
  })

  it('renders a title line and a detail line', () => {
    renderRow()

    expect(qaOne('sidebar-row-title-line')).not.toBeNull()
    expect(qaOne('sidebar-row-line2')).not.toBeNull()
  })

  it('gives the title the whole of line one', () => {
    renderRow()

    const title = qaOne('sidebar-row-title')
    expect(title?.textContent).toBe(TITLE)
    // Nothing else shares the line, so the title is free to use all of it.
    expect(qaOne('sidebar-row-title-line')?.children).toHaveLength(1)
  })

  /**
   * The timestamp used to hide on hover, which re-flowed the row under the cursor and removed
   * information at the moment the user was about to act on it.
   */
  it('keeps the timestamp visible while the row is hovered', () => {
    renderRow()

    const before = qaOne('sidebar-row-when')?.textContent
    expect(before).toBe('4h')

    const row = qaOne('sidebar-session-row')
    if (row !== null) fireEvent.mouseEnter(row)

    expect(qaOne('sidebar-row-when')?.textContent).toBe(before)
  })

  /** Hover actions overlay line one rather than joining the flow, so they displace nothing. */
  it('positions hover actions out of the row flow', () => {
    renderRow()

    const pin = screen.getByRole('button', { name: /Pin session/ })
    const container = pin.parentElement
    expect(container?.className).toContain('absolute')
  })

  it('shows the compact age, not a sentence', () => {
    renderRow({ ...session(), updatedAt: Date.now() - 30 * 60 * 1000 })

    expect(qaOne('sidebar-row-when')?.textContent).toBe('30m')
  })

  describe('provenance', () => {
    it('shows the branch as an icon whose accessible name carries the name', () => {
      useGitStore.setState({
        statusByWorkingPath: {
          [PROJECT]: {
            status: status({ branch: 'feat/sidebar-remodel' }),
            isLoading: false,
            error: null,
          },
        },
      })

      renderRow()

      const indicator = screen.getByRole('img', { name: 'On branch feat/sidebar-remodel' })
      expect(indicator).toHaveAttribute('title', 'On branch feat/sidebar-remodel')
      // The name is the widest thing the second line could carry, so it is never text.
      expect(indicator.textContent).toBe('')
    })

    it('marks a worktree session', () => {
      renderRow(session({ environmentMode: 'worktree', worktreePath: WORKTREE }))

      expect(screen.getByRole('img', { name: 'Runs in its own worktree' })).toBeInTheDocument()
    })

    it('does not mark a local-mode session as a worktree', () => {
      renderRow(session({ environmentMode: 'local', worktreePath: WORKTREE }))

      expect(
        screen.queryByRole('img', { name: 'Runs in its own worktree' }),
      ).not.toBeInTheDocument()
    })

    it('counts conversation branches when there is more than one', () => {
      renderRow(session({ branches: [branch('main'), branch('alt')] }))

      const indicator = screen.getByRole('img', { name: '2 conversation branches' })
      expect(indicator.textContent).toBe('2')
    })

    it('says nothing for a single conversation branch', () => {
      renderRow(session({ branches: [branch('main')] }))

      expect(screen.queryByRole('img', { name: /conversation branches/ })).not.toBeInTheDocument()
    })

    /** Cloning is real but the lineage is never persisted, so the row must not claim it. */
    it('never claims a session was cloned', () => {
      renderRow(session({ environmentMode: 'worktree' }))

      expect(screen.queryByRole('img', { name: /Cloned from/ })).not.toBeInTheDocument()
    })

    /** No Globe: a remote environment mode does not exist. See ADR 0020. */
    it('never shows a remote indicator', () => {
      renderRow(session({ environmentMode: 'worktree' }))

      expect(screen.queryByRole('img', { name: /[Rr]emote/ })).not.toBeInTheDocument()
    })

    it('shows divergence and no changed-file count', () => {
      useGitStore.setState({
        statusByWorkingPath: {
          [PROJECT]: {
            status: status({ clean: false, filesChanged: 57, ahead: 2 }),
            isLoading: false,
            error: null,
          },
        },
      })

      renderRow()

      expect(screen.getByRole('img', { name: '2 commits ahead' })).toBeInTheDocument()
      expect(document.body.textContent).not.toContain('57')
    })
  })

  describe('state', () => {
    it('names the state in words, so colour is never the only cue', () => {
      useSessionStatusStore.setState({
        statuses: new Map([[SESSION_ID, 'error']]),
        completedAt: new Map(),
        lastVisitedAt: new Map(),
        phases: new Map(),
      })

      renderRow()

      expect(qaOne('sidebar-row-state')?.textContent).toBe('Error')
    })

    it('adds a leading border to a row that needs a human', () => {
      useSessionStatusStore.setState({
        statuses: new Map([[SESSION_ID, 'awaiting-input']]),
        completedAt: new Map(),
        lastVisitedAt: new Map(),
        phases: new Map(),
      })

      renderRow()

      expect(qaOne('sidebar-session-row')?.className).toContain('shadow-[inset_2px_0_0')
    })

    it('leaves an in-flight row without that border, so it recedes', () => {
      useSessionStatusStore.setState({
        statuses: new Map([[SESSION_ID, 'working']]),
        completedAt: new Map(),
        lastVisitedAt: new Map(),
        phases: new Map(),
      })

      renderRow()

      expect(qaOne('sidebar-session-row')?.className).not.toContain('shadow-[inset_2px_0_0')
    })

    it('names the agent phase on an in-flight row', () => {
      useSessionStatusStore.setState({
        statuses: new Map([[SESSION_ID, 'working']]),
        completedAt: new Map(),
        lastVisitedAt: new Map(),
        phases: new Map([[SESSION_ID, 'Refactoring']]),
      })

      renderRow()

      expect(qaOne('sidebar-row-lead')?.textContent).toContain('Refactoring')
    })

    /** A phase on a finished run would describe work that is over. */
    it('hides the phase once the run is no longer in flight', () => {
      useSessionStatusStore.setState({
        statuses: new Map([[SESSION_ID, 'awaiting-input']]),
        completedAt: new Map(),
        lastVisitedAt: new Map(),
        phases: new Map([[SESSION_ID, 'Refactoring']]),
      })

      renderRow()

      expect(qaOne('sidebar-row-lead')?.textContent).not.toContain('Refactoring')
    })

    it('says nothing for an idle session', () => {
      renderRow()

      expect(qa('sidebar-row-state')).toHaveLength(0)
    })
  })

  describe('keyboard', () => {
    it('exposes the title and both actions as real buttons', () => {
      renderRow()

      expect(screen.getByRole('button', { name: TITLE })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Pin session/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Open session actions/ })).toBeInTheDocument()
    })

    it('selects the session from the keyboard', () => {
      const sessionActions = actions()
      render(
        <ul>
          <SessionListItem session={session()} isActive={false} actions={sessionActions} />
        </ul>,
      )

      fireEvent.click(screen.getByRole('button', { name: TITLE }))

      expect(sessionActions.select).toHaveBeenCalledWith(SESSION_ID)
    })
  })
})
