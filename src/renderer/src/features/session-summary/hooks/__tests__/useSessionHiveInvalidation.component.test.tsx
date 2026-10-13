import { SessionId } from '@shared/types/brand'
import { act, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { HiveHostEvent } from '@/queries/session-hive-events'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { HiveSummarySection } from '../../components/HiveSummarySection'
import { useSessionHiveInvalidation } from '../useSessionHiveInvalidation'

const { listHiveSessionCatalogPage, onSessionHostEvent, onSessionHostResyncRequired } = vi.hoisted(
  () => ({
    listHiveSessionCatalogPage: vi.fn(),
    onSessionHostEvent: vi.fn<(callback: (event: HiveHostEvent) => void) => () => void>(),
    onSessionHostResyncRequired: vi.fn<(callback: () => void) => () => void>(),
  }),
)
vi.mock('@/shared/lib/ipc', () => ({
  api: { listHiveSessionCatalogPage, onSessionHostEvent, onSessionHostResyncRequired },
}))

const queen = {
  id: SessionId('queen'),
  title: 'Queen',
  lineage: { role: 'queen', directWorkerCount: 2, activeDirectWorkerCount: 2 },
} as const
const worker = {
  id: SessionId('worker'),
  title: 'Newly spawned worker',
  lineage: {
    role: 'worker',
    parentSessionId: queen.id,
    directWorkerCount: 0,
    activeDirectWorkerCount: 0,
  },
} as const

function Harness() {
  useSessionHiveInvalidation()
  return <HiveSummarySection sessionId="queen" />
}

beforeEach(() => {
  listHiveSessionCatalogPage.mockReset()
  onSessionHostEvent.mockReset().mockReturnValue(vi.fn())
  onSessionHostResyncRequired.mockReset().mockReturnValue(vi.fn())
})

it('refreshes the focused Hive for newly spawned workers without refreshing for tokens', async () => {
  listHiveSessionCatalogPage
    .mockResolvedValueOnce({ context: [queen], workers: [] })
    .mockResolvedValueOnce({ context: [queen], workers: [worker] })
  renderWithQueryClient(<Harness />)
  // The compact row derives its counts from lineage, not from the loaded page.
  expect(await screen.findByText('2 active · 2 total')).toBeInTheDocument()
  const receive = onSessionHostEvent.mock.calls[0]?.[0]
  if (!receive) throw new Error('Host subscription missing')
  await act(async () => {
    for (let sequence = 1; sequence <= 100; sequence += 1) {
      receive({
        cursor: { hostInstanceId: 'host', sequence },
        payload: { kind: 'session-transport' },
      })
    }
    await Promise.resolve()
  })
  expect(listHiveSessionCatalogPage).toHaveBeenCalledOnce()
  await act(async () => {
    receive({
      cursor: { hostInstanceId: 'host', sequence: 101 },
      payload: { kind: 'session-list-changed' },
    })
    await Promise.resolve()
  })
  await waitFor(() => expect(listHiveSessionCatalogPage).toHaveBeenCalledTimes(2))
})

it('discards loaded continuation pages and starts at page one after Host resync', async () => {
  listHiveSessionCatalogPage
    .mockResolvedValueOnce({ context: [queen], workers: [], nextCursor: 'old-page' })
    .mockResolvedValueOnce({ context: [queen], workers: [] })
  renderWithQueryClient(<Harness />)
  expect(await screen.findByText('2 active · 2 total')).toBeInTheDocument()
  await act(async () => {
    onSessionHostResyncRequired.mock.calls[0]?.[0]()
    await Promise.resolve()
  })
  await waitFor(() => expect(listHiveSessionCatalogPage).toHaveBeenCalledTimes(2))
  // The resync drops continuation cursors: the refetch starts at page one.
  expect(listHiveSessionCatalogPage).toHaveBeenLastCalledWith(queen.id, 50, undefined)
})

it('keeps the visible Hive mounted while a Host resync refetches its first page', async () => {
  let finishRefresh: (page: {
    context: readonly [typeof queen]
    workers: readonly [typeof worker]
  }) => void = vi.fn()
  const pendingRefresh = new Promise<{
    context: readonly [typeof queen]
    workers: readonly [typeof worker]
  }>((resolve) => {
    finishRefresh = resolve
  })
  listHiveSessionCatalogPage
    .mockResolvedValueOnce({ context: [queen], workers: [worker] })
    .mockReturnValueOnce(pendingRefresh)
  renderWithQueryClient(<Harness />)
  expect(await screen.findByText('2 active · 2 total')).toBeInTheDocument()

  await act(async () => {
    onSessionHostResyncRequired.mock.calls[0]?.[0]()
    await Promise.resolve()
  })

  expect(screen.getByRole('region', { name: 'Hive' })).toBeInTheDocument()
  await act(async () => {
    finishRefresh({ context: [queen], workers: [worker] })
    await pendingRefresh
  })
})
