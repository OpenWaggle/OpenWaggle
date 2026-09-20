import { SessionId } from '@shared/types/brand'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
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
  return <HiveSummarySection sessionId="queen" onNavigateSession={vi.fn()} />
}

beforeEach(() => {
  localStorage.clear()
  listHiveSessionCatalogPage.mockReset()
  onSessionHostEvent.mockReset().mockReturnValue(vi.fn())
  onSessionHostResyncRequired.mockReset().mockReturnValue(vi.fn())
})

it('refreshes the focused Hive for newly spawned workers without refreshing for tokens', async () => {
  listHiveSessionCatalogPage
    .mockResolvedValueOnce({ context: [queen], workers: [] })
    .mockResolvedValueOnce({ context: [queen], workers: [worker] })
  renderWithQueryClient(<Harness />)
  expect(await screen.findByRole('region', { name: 'Hive' })).toBeInTheDocument()
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
  expect(await screen.findByText(worker.title)).toBeInTheDocument()
  expect(listHiveSessionCatalogPage).toHaveBeenCalledTimes(2)
})

it('discards loaded continuation pages and starts at page one after Host resync', async () => {
  listHiveSessionCatalogPage
    .mockResolvedValueOnce({ context: [queen], workers: [], nextCursor: 'old-page' })
    .mockResolvedValueOnce({ context: [queen], workers: [worker] })
    .mockResolvedValueOnce({ context: [queen], workers: [] })
  renderWithQueryClient(<Harness />)
  fireEvent.click(await screen.findByRole('button', { name: 'Load more workers' }))
  expect(await screen.findByText(worker.title)).toBeInTheDocument()
  await act(async () => {
    onSessionHostResyncRequired.mock.calls[0]?.[0]()
    await Promise.resolve()
  })
  await waitFor(() => expect(listHiveSessionCatalogPage).toHaveBeenCalledTimes(3))
  expect(listHiveSessionCatalogPage).toHaveBeenLastCalledWith(queen.id, 50, undefined)
  expect(screen.queryByText(worker.title)).not.toBeInTheDocument()
})
