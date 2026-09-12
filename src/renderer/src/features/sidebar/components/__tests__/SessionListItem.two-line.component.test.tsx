import { SessionId, SessionNodeId } from '@shared/types/brand'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGitStore } from '@/features/git'
import { useSessionStatusStore } from '@/features/sessions/state'
import { useTerminalActivityStore } from '@/features/terminal'
import { SessionListItem } from '../SessionListItem'
import {
  actions,
  branch,
  PROJECT,
  qa,
  qaOne,
  renderRow,
  SESSION_ID,
  session,
  status,
  TITLE,
  WORKTREE,
} from './SessionListItem.two-line.test-utils'

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getGitStatus: vi.fn(),
    listGitBranches: vi.fn(),
    onGitWorkingTreeChanged: () => () => {},
  },
}))

describe('two-line session row', () => {
  beforeEach(() => {
    useGitStore.setState({ statusByWorkingPath: {} })
    useSessionStatusStore.setState({
      statuses: new Map(),
      completedAt: new Map(),
      lastVisitedAt: new Map(),
      phases: new Map(),
    })
    useTerminalActivityStore.getState().reset()
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

  it('places Hive lineage below the title without taking title width', () => {
    useSessionStatusStore.setState({
      statuses: new Map([[SESSION_ID, 'working']]),
      completedAt: new Map(),
      lastVisitedAt: new Map(),
      phases: new Map(),
    })
    renderRow(
      session({
        lineage: {
          role: 'queen',
          directWorkerCount: 3,
          activeDirectWorkerCount: 2,
          agentDefinitionName: 'coordinator',
        },
      }),
    )

    const lineage = screen.getByRole('img', {
      name: 'Queen Session · Agent: coordinator · 3 direct Workers',
    })
    const lead = qaOne('sidebar-row-lead')
    const state = qaOne('sidebar-row-state')
    if (!lead || !state) throw new Error('Expected the second-line status metadata')
    expect(qaOne('sidebar-row-title-line')?.contains(lineage)).toBe(false)
    expect(qaOne('sidebar-row-title-line')?.children).toHaveLength(1)
    expect(qaOne('sidebar-row-line2')?.contains(lineage)).toBe(true)
    expect([...lead.children].indexOf(state)).toBeLessThan([...lead.children].indexOf(lineage))
  })

  /**
   * The timestamp used to hide on hover, which re-flowed the row under the cursor and removed
   * information at the moment the user was about to act on it.
   *
   * Asserted structurally: the timestamp is not inside the container that hover reveals, so no
   * hover state can take it away. The visual claim, that it does not move or fade, needs real CSS
   * and is owned by e2e/sidebar-remodel.e2e.test.ts. A jsdom assertion about hover visibility
   * would be vacuous, because the component config loads no stylesheet.
   */
  it('keeps the timestamp out of the hover-revealed container', () => {
    renderRow()

    const when = qaOne('sidebar-row-when')
    const pin = screen.getByRole('button', { name: /Pin session/ })
    const hoverContainer = pin.parentElement

    expect(when?.textContent).toBe('4h')
    expect(hoverContainer).not.toBeNull()
    expect(hoverContainer?.contains(when ?? null)).toBe(false)
    // Line two owns it, which is what makes it survive every row state.
    expect(qaOne('sidebar-row-line2')?.contains(when ?? null)).toBe(true)
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

    it('shows one semantic running status per terminal with an observed subprocess', () => {
      useTerminalActivityStore.getState().applySnapshot({
        revision: 1,
        summaries: [
          {
            ownerKey: String(SESSION_ID),
            terminalId: 'main',
            activityStatus: 'running',
            processName: 'pnpm',
            ports: [],
            projectActionPending: false,
          },
          {
            ownerKey: String(SESSION_ID),
            terminalId: 'side',
            activityStatus: 'idle',
            processName: null,
            ports: [],
            projectActionPending: false,
          },
          {
            ownerKey: String(SESSION_ID),
            terminalId: 'right',
            activityStatus: 'unknown',
            processName: null,
            ports: [],
            projectActionPending: false,
          },
        ],
        truncated: false,
      })

      renderRow()

      const indicator = screen.getByRole('img', { name: '1 terminal running a subprocess' })
      expect(indicator).toHaveTextContent('1')
      expect(indicator.className).toContain('text-progress')
      expect(qaOne('sidebar-session-row')).toHaveAttribute(
        'title',
        expect.stringContaining('1 terminal running a subprocess'),
      )
    })

    it('shows the persisted fork source', () => {
      renderRow(
        session({
          derivation: {
            sourceSessionId: SessionId('session-source'),
            sourceTitle: 'Original investigation',
            sourceNodeId: SessionNodeId('node-source'),
            position: 'at',
          },
        }),
      )

      expect(
        screen.getByRole('img', { name: 'Cloned from Original investigation' }),
      ).toBeInTheDocument()
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
