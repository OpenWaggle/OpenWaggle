import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSidebarSessionActions } from '@/features/sidebar/hooks'
import { queryKeys } from '@/queries/query-keys'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { useSessionSummaryUIStore } from '../../state/session-summary-ui-store'
import { HiveSummarySection } from '../HiveSummarySection'

const getSessionHiveRelations = vi.hoisted(() => vi.fn())
const archiveSession = vi.hoisted(() => vi.fn())
const showConfirm = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({
  api: { archiveSession, getSessionHiveRelations, showConfirm },
}))

function renderHive(sessionId: string, onNavigateSession = vi.fn()) {
  return renderWithQueryClient(
    <HiveSummarySection sessionId={sessionId} onNavigateSession={onNavigateSession} />,
  )
}

function queen(activeDirectWorkerCount: number): SessionSummary {
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

function worker(state: 'working' | 'accepted' | 'needs_attention'): SessionSummary {
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

function hiveRelations(
  current: SessionSummary | null,
  workers: readonly SessionSummary[] = [],
  parent: SessionSummary | null = null,
) {
  return { current, parent, workers }
}

describe('HiveSummarySection', () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionSummaryUIStore.setState({ toggleFocusTargetSessionId: null })
    getSessionHiveRelations.mockReset().mockResolvedValue(hiveRelations(null))
    archiveSession.mockReset().mockResolvedValue(undefined)
    showConfirm.mockReset().mockResolvedValue(true)
  })

  it('expands active Hive work by default and navigates to the selected worker', async () => {
    getSessionHiveRelations.mockResolvedValue(hiveRelations(queen(1), [worker('working')]))
    const onNavigateSession = vi.fn()
    renderHive('queen', onNavigateSession)

    expect(await screen.findByRole('region', { name: 'Hive' })).toBeInTheDocument()
    expect(screen.getByText('1 active · 1 total')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Worker.*Worker session/ }))
    expect(onNavigateSession).toHaveBeenCalledWith('worker')
    expect(useSessionSummaryUIStore.getState().toggleFocusTargetSessionId).toBe('worker')
  })

  it('collapses an all-done Hive by default while honoring a per-session override', async () => {
    getSessionHiveRelations.mockResolvedValue(hiveRelations(queen(0), [worker('accepted')]))
    const first = renderHive('queen')
    const trigger = await screen.findByRole('button', { name: /Hive/ })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trigger)
    expect(screen.getByText('Worker session')).toBeInTheDocument()
    first.unmount()

    renderHive('queen')
    expect(await screen.findByRole('button', { name: /Hive/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('does not show Hive information for an unrelated opened session', async () => {
    getSessionHiveRelations.mockResolvedValue(hiveRelations(null))
    renderHive('another-session')
    await waitFor(() => expect(getSessionHiveRelations).toHaveBeenCalledOnce())
    expect(screen.queryByRole('region', { name: 'Hive' })).toBeNull()
  })

  it('groups archived workers separately and keeps them navigable', async () => {
    getSessionHiveRelations.mockResolvedValue(
      hiveRelations(queen(0), [
        worker('accepted'),
        {
          ...worker('accepted'),
          id: SessionId('archived-worker'),
          title: 'Archived worker',
          archived: true,
        },
      ]),
    )
    const onNavigateSession = vi.fn()
    renderHive('queen', onNavigateSession)
    fireEvent.click(await screen.findByRole('button', { name: /Hive/ }))

    expect(await screen.findByLabelText('Archived Hive sessions')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Archived.*Archived worker/ }))
    expect(onNavigateSession).toHaveBeenCalledWith('archived-worker')
  })

  it('moves a live worker into the mounted Hive archived group immediately after archiving', async () => {
    const liveWorker = worker('accepted')
    let isArchived = false
    getSessionHiveRelations.mockImplementation(async () =>
      hiveRelations(queen(0), [{ ...liveWorker, ...(isArchived ? { archived: true } : {}) }]),
    )
    archiveSession.mockImplementation(async () => {
      isArchived = true
    })
    const view = renderHive('queen')
    fireEvent.click(await screen.findByRole('button', { name: /Hive/ }))
    expect(screen.getByLabelText('Done Hive sessions')).toBeInTheDocument()
    const navigate: Parameters<typeof createSidebarSessionActions>[0]['navigate'] = vi.fn()

    const actions = createSidebarSessionActions({
      activeSessionId: null,
      matchingActiveSessionTree: null,
      matchingActiveWorkspace: null,
      navigate,
      projectPath: '/project',
      queryClient: view.client,
      selectedModel: SupportedModelId('openai/gpt-5'),
      showToast: vi.fn(),
      startDraftSession: vi.fn(),
      clearTransientDraftContext: vi.fn(),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      loadChatSessions: vi.fn().mockResolvedValue(undefined),
      loadSessionTrees: vi.fn().mockResolvedValue(undefined),
      refreshSessionWorkspace: vi.fn().mockResolvedValue(undefined),
      togglePin: vi.fn(),
    })
    actions.archive(liveWorker.id)

    await waitFor(() => expect(archiveSession).toHaveBeenCalledWith(liveWorker.id))
    expect(await screen.findByLabelText('Archived Hive sessions')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Archived.*Worker session/ })).toBeInTheDocument()
    expect(screen.queryByLabelText('Done Hive sessions')).toBeNull()
  })

  it('keeps an archived parent navigable from an active worker', async () => {
    getSessionHiveRelations.mockResolvedValue(
      hiveRelations(worker('working'), [], { ...queen(0), archived: true }),
    )
    const onNavigateSession = vi.fn()
    renderHive('worker', onNavigateSession)

    const parent = await screen.findByRole('button', { name: /Parent.*Queen session/ })
    fireEvent.click(parent)
    expect(onNavigateSession).toHaveBeenCalledWith('queen')
  })

  it('keeps Hive navigation available when the opened worker is archived', async () => {
    getSessionHiveRelations.mockResolvedValue(
      hiveRelations({ ...worker('accepted'), archived: true }, [], queen(0)),
    )
    const onNavigateSession = vi.fn()
    renderHive('worker', onNavigateSession)

    expect(await screen.findByRole('button', { name: /Hive/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    const parent = await screen.findByRole('button', { name: /Parent.*Queen session/ })
    fireEvent.click(parent)
    expect(onNavigateSession).toHaveBeenCalledWith('queen')
  })

  it('batches large worker groups instead of mounting every row at once', async () => {
    const workers = Array.from({ length: 8 }, (_, index) => ({
      ...worker('working'),
      id: SessionId(`worker-${String(index + 1)}`),
      title: `Worker ${String(index + 1)}`,
    }))
    getSessionHiveRelations.mockResolvedValue(hiveRelations(queen(workers.length), workers))
    renderHive('queen')

    expect(await screen.findByText('Worker 6')).toBeInTheDocument()
    expect(screen.queryByText('Worker 7')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 more' }))
    expect(screen.getByText('Worker 8')).toBeInTheDocument()
  })

  it('keeps completed work visible briefly before automatically collapsing it', async () => {
    getSessionHiveRelations.mockResolvedValue(hiveRelations(queen(1), [worker('working')]))
    const view = renderHive('queen')
    const trigger = await screen.findByRole('button', { name: /Hive/ })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    vi.useFakeTimers()
    act(() => {
      view.client.setQueryData(queryKeys.sessionHive(SessionId('queen')), {
        pages: [hiveRelations(queen(0), [worker('accepted')])],
        pageParams: [undefined],
      })
    })
    act(() => vi.advanceTimersByTime(0))
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    screen.getByRole('button', { name: /Done.*Worker session/ }).focus()
    act(() => vi.advanceTimersByTime(2_499))
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    act(() => vi.advanceTimersByTime(1))
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveFocus()
    vi.useRealTimers()
  })
})
