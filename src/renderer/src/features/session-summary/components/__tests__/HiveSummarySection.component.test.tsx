import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { HiveSummarySection } from '../HiveSummarySection'

const getSessionHiveRelations = vi.hoisted(() => vi.fn())
const showRightPanelSurface = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({ api: { getSessionHiveRelations } }))
vi.mock('@/shared/lib/right-panel-surfaces', () => ({ showRightPanelSurface }))

function renderHive(sessionId: string) {
  return renderWithQueryClient(<HiveSummarySection sessionId={sessionId} />)
}

function queen(activeDirectWorkerCount: number, directWorkerCount = 1): SessionSummary {
  return {
    id: SessionId('queen'),
    title: 'Queen session',
    projectPath: '/project',
    createdAt: 1000,
    updatedAt: 1000,
    lineage: {
      role: 'queen' as const,
      directWorkerCount,
      activeDirectWorkerCount,
      agentDefinitionName: 'Coordinator',
    },
  }
}

function worker(
  state: 'working' | 'ready_for_review' | 'accepted' | 'needs_attention',
  id = 'worker',
): SessionSummary {
  return {
    id: SessionId(id),
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

function hiveRelations(
  current: SessionSummary | null,
  workers: readonly SessionSummary[] = [],
  parent: SessionSummary | null = null,
) {
  return { current, parent, workers }
}

describe('HiveSummarySection', () => {
  beforeEach(() => {
    getSessionHiveRelations.mockReset().mockResolvedValue(hiveRelations(null))
    showRightPanelSurface.mockReset()
  })

  it('summarizes the Hive in one row and opens the Hive panel', async () => {
    getSessionHiveRelations.mockResolvedValue(hiveRelations(queen(1), [worker('working')]))
    renderHive('queen')

    expect(await screen.findByRole('region', { name: 'Hive' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Hive' })).toHaveTextContent(
      '1 direct Worker · 1 active',
    )
    expect(screen.queryByText('Worker session')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open in Hive panel' }))
    expect(showRightPanelSurface).toHaveBeenCalledWith('hive')
  })

  it('reports attention in the warning colour', async () => {
    getSessionHiveRelations.mockResolvedValue(hiveRelations(queen(1), [worker('needs_attention')]))
    renderHive('queen')

    const attention = await screen.findByText('1 needs attention')
    expect(attention.className).toContain('text-warning')
  })

  it('names its scope and surfaces Workers waiting for review instead of "0 active"', async () => {
    getSessionHiveRelations.mockResolvedValue(
      hiveRelations(queen(0, 3), [
        worker('ready_for_review', 'one'),
        worker('ready_for_review', 'two'),
        worker('ready_for_review', 'three'),
      ]),
    )
    renderHive('queen')

    const region = await screen.findByRole('region', { name: 'Hive' })
    await waitFor(() => expect(region).toHaveTextContent('3 direct Workers · 3 ready for review'))
    expect(region).not.toHaveTextContent('active')
    expect(screen.getByText('3 ready for review').className).toContain('text-info-text')
  })

  it('marks counts as lower bounds while more Workers are unread', async () => {
    getSessionHiveRelations.mockResolvedValue(hiveRelations(queen(0, 60), [worker('accepted')]))
    renderHive('queen')

    const region = await screen.findByRole('region', { name: 'Hive' })
    await waitFor(() => expect(region).toHaveTextContent('60 direct Workers · 1+ closed'))
  })

  it('does not offer the Hive panel for a historical Hive it cannot list', async () => {
    getSessionHiveRelations.mockResolvedValue(
      hiveRelations({
        ...worker('working'),
        lineage: {
          role: 'worker',
          parentSessionId: SessionId('queen'),
          directWorkerCount: 0,
          activeDirectWorkerCount: 0,
          delegationState: 'working',
          historical: true,
        },
      }),
    )
    renderHive('worker')

    expect(await screen.findByRole('region', { name: 'Hive' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open in Hive panel' })).toBeNull()
  })

  it('shows nothing for an unrelated opened session', async () => {
    getSessionHiveRelations.mockResolvedValue(hiveRelations(null))
    renderHive('another-session')
    await waitFor(() => expect(getSessionHiveRelations).toHaveBeenCalledOnce())
    expect(screen.queryByRole('region', { name: 'Hive' })).toBeNull()
  })

  it('offers a retry when the Hive cannot load', async () => {
    getSessionHiveRelations.mockRejectedValue(new Error('Host unavailable'))
    renderHive('queen')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Unable to load this session's Hive.",
    )
    getSessionHiveRelations.mockResolvedValue(hiveRelations(queen(0)))
    fireEvent.click(screen.getByRole('button', { name: 'Retry Hive' }))
    expect(await screen.findByRole('region', { name: 'Hive' })).toBeInTheDocument()
  })
})
