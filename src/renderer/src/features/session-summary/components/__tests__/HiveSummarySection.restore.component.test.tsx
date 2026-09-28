import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStore } from '@/features/sessions/state'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { useSessionSummaryUIStore } from '../../state/session-summary-ui-store'
import { HiveSummarySection } from '../HiveSummarySection'

const getSessionHiveRelations = vi.hoisted(() => vi.fn())
const unarchiveSession = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({
  api: { getSessionHiveRelations, unarchiveSession },
}))

const queen: SessionSummary = {
  id: SessionId('queen'),
  title: 'Queen session',
  projectPath: '/project',
  createdAt: 1000,
  updatedAt: 1000,
  lineage: { role: 'queen', directWorkerCount: 1, activeDirectWorkerCount: 0 },
}

function cleanedUpWorker(archived: boolean): SessionSummary {
  return {
    id: SessionId('worker'),
    title: 'Cleaned-up worker',
    projectPath: '/project',
    createdAt: 1000,
    updatedAt: 1000,
    ...(archived ? { archived: true } : {}),
    lineage: {
      role: 'worker',
      parentSessionId: SessionId('queen'),
      directWorkerCount: 0,
      activeDirectWorkerCount: 0,
      delegationState: 'accepted',
    },
  }
}

async function openArchivedWorkers(onNavigateSession = vi.fn()) {
  renderWithQueryClient(
    <HiveSummarySection sessionId="queen" onNavigateSession={onNavigateSession} />,
  )
  fireEvent.click(await screen.findByRole('button', { name: /Hive/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Expand archived Workers' }))
  return screen.findByRole('button', { name: 'Restore Worker Session: Cleaned-up worker' })
}

describe('HiveSummarySection archived Worker restore', () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionSummaryUIStore.setState({ toggleFocusTargetSessionId: null })
    getSessionHiveRelations.mockReset()
    unarchiveSession.mockReset()
  })

  it('restores an automatically archived Worker and moves it back out of Archived', async () => {
    const loadSessions = vi.fn().mockResolvedValue(undefined)
    useSessionStore.setState({ loadSessions })
    let archived = true
    getSessionHiveRelations.mockImplementation(async () => ({
      current: queen,
      parent: null,
      workers: [cleanedUpWorker(archived)],
    }))
    unarchiveSession.mockImplementation(async () => {
      archived = false
    })
    const onNavigateSession = vi.fn()

    fireEvent.click(await openArchivedWorkers(onNavigateSession))

    await waitFor(() => expect(unarchiveSession).toHaveBeenCalledWith('worker'))
    expect(await screen.findByLabelText('Done Hive sessions')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Expand archived Workers' })).toBeNull()
    expect(loadSessions).toHaveBeenCalled()
    expect(onNavigateSession).not.toHaveBeenCalled()
  })

  it('keeps the Worker archived and explains the failure when restore is refused', async () => {
    useSessionStore.setState({ loadSessions: vi.fn().mockResolvedValue(undefined) })
    getSessionHiveRelations.mockResolvedValue({
      current: queen,
      parent: null,
      workers: [cleanedUpWorker(true)],
    })
    unarchiveSession.mockRejectedValue(new Error('Host refused'))

    fireEvent.click(await openArchivedWorkers())

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to restore Cleaned-up worker.',
    )
    expect(screen.getByLabelText('Archived Hive sessions')).toBeInTheDocument()
  })
})
