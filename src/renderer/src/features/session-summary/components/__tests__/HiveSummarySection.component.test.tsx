import { SessionId } from '@shared/types/brand'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '@/features/sessions/state'
import { HiveSummarySection } from '../HiveSummarySection'

function queen(activeDirectWorkerCount: number) {
  return {
    id: SessionId('queen'),
    title: 'Queen session',
    projectPath: '/project',
    createdAt: 1000,
    updatedAt: 1000,
    lineage: {
      role: 'queen' as const,
      directWorkerCount: 1,
      activeDirectWorkerCount,
      agentDefinitionName: 'Coordinator',
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
      delegationState: state,
    },
  }
}

describe('HiveSummarySection', () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionStore.setState({ sessions: [] })
  })

  it('expands active Hive work by default and navigates to the selected worker', () => {
    useSessionStore.setState({ sessions: [queen(1), worker('working')] })
    const onNavigateSession = vi.fn()
    render(<HiveSummarySection sessionId="queen" onNavigateSession={onNavigateSession} />)

    expect(screen.getByRole('region', { name: 'Hive' })).toBeInTheDocument()
    expect(screen.getByText('1 active · 1 total')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Worker.*Worker session/ }))
    expect(onNavigateSession).toHaveBeenCalledWith('worker')
  })

  it('collapses an all-done Hive by default while honoring a per-session override', () => {
    useSessionStore.setState({ sessions: [queen(0), worker('accepted')] })
    const first = render(<HiveSummarySection sessionId="queen" onNavigateSession={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: /Hive/ })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trigger)
    expect(screen.getByText('Worker session')).toBeInTheDocument()
    first.unmount()

    render(<HiveSummarySection sessionId="queen" onNavigateSession={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Hive/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('does not show Hive information for an unrelated opened session', () => {
    useSessionStore.setState({ sessions: [queen(1), worker('needs_attention')] })
    render(<HiveSummarySection sessionId="another-session" onNavigateSession={vi.fn()} />)
    expect(screen.queryByRole('region', { name: 'Hive' })).toBeNull()
  })
})
