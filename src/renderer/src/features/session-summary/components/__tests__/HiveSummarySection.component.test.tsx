import { SessionId } from '@shared/types/brand'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '@/features/sessions/state'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { HiveSummarySection } from '../HiveSummarySection'

const listArchivedSessions = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({
  api: { listArchivedSessions },
}))

function renderHive(sessionId: string, onNavigateSession = vi.fn()) {
  return renderWithQueryClient(
    <HiveSummarySection sessionId={sessionId} onNavigateSession={onNavigateSession} />,
  )
}

function queen(activeDirectWorkerCount: number) {
  return {
    id: SessionId('queen'),
    title: 'Queen session',
    projectPath: '/project',
    createdAt: 1000,
    updatedAt: 1000,
    lineage: {
      role: 'queen' as const,
      parentSessionId: null,
      directWorkerCount: 1,
      activeDirectWorkerCount,
      agentDefinitionName: 'Coordinator',
      delegationState: null,
    },
  }
}

function worker(state: 'working' | 'accepted' | 'needs_attention') {
  return {
    id: SessionId('worker'),
    title: 'Worker session',
    projectPath: '/project',
    createdAt: 1000,
    updatedAt: 1000,
    lineage: {
      role: 'worker' as const,
      parentSessionId: SessionId('queen'),
      directWorkerCount: 0,
      activeDirectWorkerCount: 0,
      agentDefinitionName: null,
      delegationState: state,
    },
  }
}

describe('HiveSummarySection', () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionStore.setState({ sessions: [] })
    listArchivedSessions.mockReset().mockResolvedValue([])
  })

  it('expands active Hive work by default and navigates to the selected worker', () => {
    useSessionStore.setState({ sessions: [queen(1), worker('working')] })
    const onNavigateSession = vi.fn()
    renderHive('queen', onNavigateSession)

    expect(screen.getByRole('region', { name: 'Hive' })).toBeInTheDocument()
    expect(screen.getByText('1 active · 1 total')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Worker.*Worker session/ }))
    expect(onNavigateSession).toHaveBeenCalledWith('worker')
  })

  it('collapses an all-done Hive by default while honoring a per-session override', () => {
    useSessionStore.setState({ sessions: [queen(0), worker('accepted')] })
    const first = renderHive('queen')
    const trigger = screen.getByRole('button', { name: /Hive/ })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trigger)
    expect(screen.getByText('Worker session')).toBeInTheDocument()
    first.unmount()

    renderHive('queen')
    expect(screen.getByRole('button', { name: /Hive/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('does not show Hive information for an unrelated opened session', () => {
    useSessionStore.setState({ sessions: [queen(1), worker('needs_attention')] })
    renderHive('another-session')
    expect(screen.queryByRole('region', { name: 'Hive' })).toBeNull()
  })

  it('groups archived workers separately and keeps them navigable', async () => {
    useSessionStore.setState({ sessions: [queen(0), worker('accepted')] })
    listArchivedSessions.mockResolvedValue([
      {
        ...worker('accepted'),
        id: SessionId('archived-worker'),
        title: 'Archived worker',
        archived: true,
      },
    ])
    const onNavigateSession = vi.fn()
    renderHive('queen', onNavigateSession)
    fireEvent.click(screen.getByRole('button', { name: /Hive/ }))

    expect(await screen.findByLabelText('Archived Hive sessions')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Archived.*Archived worker/ }))
    expect(onNavigateSession).toHaveBeenCalledWith('archived-worker')
  })

  it('keeps an archived parent navigable from an active worker', async () => {
    useSessionStore.setState({ sessions: [worker('working')] })
    listArchivedSessions.mockResolvedValue([{ ...queen(0), archived: true }])
    const onNavigateSession = vi.fn()
    renderHive('worker', onNavigateSession)

    const parent = await screen.findByRole('button', { name: /Parent.*Queen session/ })
    fireEvent.click(parent)
    expect(onNavigateSession).toHaveBeenCalledWith('queen')
  })
})
