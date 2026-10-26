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
  state: 'working' | 'ready_for_review' | 'accepted' | 'needs_attention' | 'revision_requested',
  id = 'worker',
  facts: { readonly parentWillAct?: boolean } = {},
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
      ...facts,
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
      '1 direct Worker · 1 working',
    )
    expect(screen.queryByText('Worker session')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open in Hive panel' }))
    expect(showRightPanelSurface).toHaveBeenCalledWith('hive')
  })

  it('reports only Needs you in the warning colour (#380)', async () => {
    // The Queen is idle with nothing queued: the failed Worker is stuck.
    getSessionHiveRelations.mockResolvedValue(
      hiveRelations(queen(2, 2), [
        worker('needs_attention', 'stuck'),
        worker('revision_requested', 'revising'),
      ]),
    )
    renderHive('queen')

    const needsYou = await screen.findByText('1 needs you')
    expect(needsYou.className).toContain('text-warning')
    // Revising at the Queen's request is the Worker's to do, not the person's.
    expect(screen.getByRole('region', { name: 'Hive' })).toHaveTextContent(
      '2 direct Workers · 1 needs you · 1 working',
    )
  })

  it('counts a failure the running Queen will pick up as waiting for her, not as Needs you', async () => {
    getSessionHiveRelations.mockResolvedValue(
      hiveRelations(queen(1), [worker('needs_attention', 'failed', { parentWillAct: true })]),
    )
    renderHive('queen')

    const waiting = await screen.findByText('1 waiting for Queen session')
    expect(waiting.className).not.toContain('text-warning')
    expect(screen.queryByText(/needs? you/u)).toBeNull()
  })

  it('names its scope and counts Workers waiting for review as waiting for the parent', async () => {
    getSessionHiveRelations.mockResolvedValue(
      hiveRelations(queen(0, 3), [
        worker('ready_for_review', 'one'),
        worker('ready_for_review', 'two'),
        worker('ready_for_review', 'three'),
      ]),
    )
    renderHive('queen')

    const region = await screen.findByRole('region', { name: 'Hive' })
    await waitFor(() =>
      expect(region).toHaveTextContent('3 direct Workers · 3 waiting for Queen session'),
    )
    expect(region).not.toHaveTextContent('working')
  })

  it('marks counts as lower bounds while more Workers are unread', async () => {
    getSessionHiveRelations.mockResolvedValue(hiveRelations(queen(0, 60), [worker('accepted')]))
    renderHive('queen')

    const region = await screen.findByRole('region', { name: 'Hive' })
    await waitFor(() => expect(region).toHaveTextContent('60 direct Workers · 1+ closed'))
  })

  it('names the Session that spawned a Worker, in the Hive panel’s words', async () => {
    const current = worker('working')
    getSessionHiveRelations.mockResolvedValue(
      hiveRelations({
        ...current,
        lineage: {
          role: 'worker',
          parentSessionId: SessionId('queen'),
          parentTitle: 'Queen session',
          directWorkerCount: 0,
          activeDirectWorkerCount: 0,
          delegationState: 'working',
        },
      }),
    )
    renderHive('worker')

    expect(await screen.findByText('Spawned by Queen session')).toBeInTheDocument()
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
