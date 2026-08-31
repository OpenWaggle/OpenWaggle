import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStatusStore, useSessionStore } from '@/features/sessions/state'
import { HiveSessionNavigator } from '../HiveSessionNavigator'

const QUEEN_ID = SessionId('queen')
const WORKER_ID = SessionId('worker')
const DONE_WORKER_ID = SessionId('done-worker')
const ARCHIVED_WORKER_ID = SessionId('archived-worker')
const NESTED_WORKER_ID = SessionId('nested-worker')

function queen(): SessionSummary {
  return {
    id: QUEEN_ID,
    title: 'Coordinate release',
    projectPath: '/repo',
    createdAt: 1,
    updatedAt: 1,
    lineage: {
      role: 'queen',
      directWorkerCount: 1,
      activeDirectWorkerCount: 1,
    },
  }
}

function worker(): SessionSummary {
  return {
    id: WORKER_ID,
    title: 'Validate migration',
    projectPath: '/repo',
    createdAt: 2,
    updatedAt: 2,
    lineage: {
      role: 'worker',
      parentSessionId: QUEEN_ID,
      parentTitle: 'Coordinate release',
      hiveRootSessionId: QUEEN_ID,
      directWorkerCount: 0,
      activeDirectWorkerCount: 0,
      delegationId: 'delegation-worker',
      delegationState: 'ready_for_review',
      agentDefinitionName: 'release-verifier',
    },
  }
}

function doneWorker(): SessionSummary {
  return {
    id: DONE_WORKER_ID,
    title: 'Document migration',
    projectPath: '/repo',
    createdAt: 3,
    updatedAt: 3,
    lineage: {
      role: 'worker',
      parentSessionId: QUEEN_ID,
      parentTitle: 'Coordinate release',
      hiveRootSessionId: QUEEN_ID,
      directWorkerCount: 0,
      activeDirectWorkerCount: 0,
      delegationId: 'delegation-done-worker',
      delegationState: 'accepted',
    },
  }
}

function archivedWorker(): SessionSummary {
  return {
    ...worker(),
    id: ARCHIVED_WORKER_ID,
    title: 'Archived investigation',
    archived: true,
    lineage: {
      role: 'worker',
      parentSessionId: QUEEN_ID,
      parentTitle: 'Coordinate release',
      hiveRootSessionId: QUEEN_ID,
      directWorkerCount: 0,
      activeDirectWorkerCount: 0,
      delegationId: 'delegation-archived-worker',
      delegationState: 'needs_attention',
    },
  }
}

describe('HiveSessionNavigator', () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionStore.setState({
      sessions: [queen(), worker(), doneWorker()],
      archivedSessions: [archivedWorker()],
    })
    useSessionStatusStore.setState({
      statuses: new Map([[WORKER_ID, 'working']]),
      phases: new Map([[WORKER_ID, 'Testing']]),
      completedAt: new Map(),
      lastVisitedAt: new Map(),
    })
  })

  it('shows a Queen its direct Workers and limits disclosure hover to the collapse button', () => {
    const onNavigateSession = vi.fn()
    render(<HiveSessionNavigator sessionId={QUEEN_ID} onNavigateSession={onNavigateSession} />)

    const region = screen.getByRole('region', { name: 'Hive Sessions' })
    const collapse = screen.getByRole('button', { name: 'Collapse Hive Sessions' })
    expect(region).toBeInTheDocument()
    expect(region).not.toHaveClass('hover:bg-bg-hover')
    expect(collapse).toHaveClass('hover:bg-bg-hover')
    expect(screen.getByText('Validate migration')).toBeInTheDocument()
    expect(screen.getByText('Ready for review')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getByText('Document migration')).toBeInTheDocument()
    expect(screen.getByText('Archived · 1')).toBeInTheDocument()
    expect(screen.queryByText('Archived investigation')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand archived Workers' }))
    expect(screen.getByText('Archived investigation')).toBeInTheDocument()

    fireEvent.click(collapse)
    expect(screen.queryByText('Validate migration')).not.toBeInTheDocument()
    expect(localStorage.getItem('openwaggle:hive-navigator-collapsed:queen')).toBe('true')
  })

  it('keeps collapse state scoped to each Session during navigation', () => {
    const { rerender } = render(
      <HiveSessionNavigator sessionId={QUEEN_ID} onNavigateSession={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Hive Sessions' }))

    rerender(<HiveSessionNavigator sessionId={WORKER_ID} onNavigateSession={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Expand Hive Sessions' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open parent Session/ })).toBeVisible()

    rerender(<HiveSessionNavigator sessionId={QUEEN_ID} onNavigateSession={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Expand Hive Sessions' })).toBeInTheDocument()
  })

  it('gives a Worker a reciprocal shortcut to its Queen', () => {
    const onNavigateSession = vi.fn()
    render(<HiveSessionNavigator sessionId={WORKER_ID} onNavigateSession={onNavigateSession} />)

    const parentShortcut = screen.getByRole('button', { name: /Open parent Session/ })
    expect(screen.getByText('release-verifier')).toBeVisible()
    expect(parentShortcut).toHaveTextContent('Parent')
    expect(parentShortcut).toHaveTextContent('Coordinate release')
    expect(screen.getByRole('button', { name: 'Expand Hive Sessions' })).toBeVisible()
    expect(screen.queryByText('Document migration')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Open parent Session/ }))
    expect(onNavigateSession).toHaveBeenCalledWith(QUEEN_ID)
  })

  it.each([
    ['idle', 'Idle'],
    ['completed', 'Done'],
    ['error', 'Error'],
  ] as const)('shows the parent Session runtime state when it is %s', (status, label) => {
    useSessionStatusStore.setState((state) => ({
      statuses: new Map(state.statuses).set(QUEEN_ID, status),
    }))
    render(<HiveSessionNavigator sessionId={WORKER_ID} onNavigateSession={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Expand Hive Sessions' }))

    expect(
      screen.getByRole('button', { name: 'Open Queen Session: Coordinate release' }),
    ).toHaveTextContent(label)
  })

  it('labels an immediate Worker parent as a Worker in a nested Hive', () => {
    useSessionStore.setState((state) => ({
      sessions: [
        ...state.sessions.map((session) => {
          if (session.id !== WORKER_ID || session.lineage?.role !== 'worker') return session
          return {
            ...session,
            lineage: { ...session.lineage, directWorkerCount: 1, activeDirectWorkerCount: 1 },
          }
        }),
        {
          id: NESTED_WORKER_ID,
          title: 'Inspect nested runtime',
          projectPath: '/repo',
          createdAt: 4,
          updatedAt: 4,
          lineage: {
            role: 'worker',
            parentSessionId: WORKER_ID,
            parentTitle: 'Validate migration',
            hiveRootSessionId: QUEEN_ID,
            directWorkerCount: 0,
            activeDirectWorkerCount: 0,
          },
        },
      ],
    }))

    render(<HiveSessionNavigator sessionId={NESTED_WORKER_ID} onNavigateSession={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Expand Hive Sessions' }))

    expect(
      screen.getByRole('button', { name: 'Open Worker Session: Validate migration' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Open Queen Session: Validate migration' }),
    ).not.toBeInTheDocument()
  })

  it('auto-expands when a leaf Worker creates its first Worker unless explicitly toggled', () => {
    const view = render(<HiveSessionNavigator sessionId={WORKER_ID} onNavigateSession={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Expand Hive Sessions' })).toBeVisible()

    useSessionStore.setState((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === WORKER_ID && session.lineage?.role === 'worker'
          ? {
              ...session,
              lineage: { ...session.lineage, directWorkerCount: 1, activeDirectWorkerCount: 1 },
            }
          : session,
      ),
    }))
    view.rerender(<HiveSessionNavigator sessionId={WORKER_ID} onNavigateSession={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Collapse Hive Sessions' })).toBeVisible()
  })
})
