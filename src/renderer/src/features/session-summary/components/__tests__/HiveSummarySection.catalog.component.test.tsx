import { SessionId } from '@shared/types/brand'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { HiveCatalogPage } from '@/queries/session-hive-contract'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { HiveSummarySection } from '../HiveSummarySection'

const listHiveSessionCatalogPage = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({ api: { listHiveSessionCatalogPage } }))

const queen = {
  id: SessionId('queen'),
  title: 'Queen',
  lineage: { role: 'queen', directWorkerCount: 2, activeDirectWorkerCount: 1 },
} as const

const worker = {
  id: SessionId('worker'),
  title: 'Worker on page two',
  lineage: {
    role: 'worker',
    directWorkerCount: 0,
    activeDirectWorkerCount: 0,
    delegationState: 'working',
  },
} as const

beforeEach(() => {
  localStorage.clear()
  listHiveSessionCatalogPage.mockReset()
})

it('keeps parent navigation available when the Host omits the focused Worker parent ID', async () => {
  listHiveSessionCatalogPage.mockResolvedValueOnce({ context: [worker, queen], workers: [] })
  const navigate = vi.fn()
  renderWithQueryClient(<HiveSummarySection sessionId="worker" onNavigateSession={navigate} />)
  fireEvent.click(await screen.findByRole('button', { name: /Queen/ }))
  expect(navigate).toHaveBeenCalledWith('queen')
})

it('retries a failed later page without losing previously loaded workers', async () => {
  listHiveSessionCatalogPage
    .mockResolvedValueOnce({ context: [queen], workers: [worker], nextCursor: 'second-page' })
    .mockRejectedValueOnce(new Error('Host unavailable'))
    .mockResolvedValueOnce({
      context: [queen],
      workers: [{ ...worker, id: SessionId('worker-2'), title: 'Recovered worker' }],
    })
  renderWithQueryClient(<HiveSummarySection sessionId="queen" onNavigateSession={vi.fn()} />)
  expect(await screen.findByText(worker.title)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Load more workers' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load more workers')
  expect(screen.getByText(worker.title)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Retry Hive' }))
  expect(await screen.findByText('Recovered worker')).toBeInTheDocument()
})

it('ignores a late page from the previous opened session', async () => {
  let resolvePage: (page: HiveCatalogPage) => void = vi.fn()
  const pendingPage = new Promise<HiveCatalogPage>((resolve) => {
    resolvePage = resolve
  })
  listHiveSessionCatalogPage
    .mockResolvedValueOnce({ context: [queen], workers: [], nextCursor: 'late-page' })
    .mockReturnValueOnce(pendingPage)
    .mockResolvedValueOnce({
      context: [{ id: SessionId('separate'), title: 'Separate' }],
      workers: [],
    })
  const view = renderWithQueryClient(
    <HiveSummarySection sessionId="queen" onNavigateSession={vi.fn()} />,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Load more workers' }))
  view.rerender(
    <QueryClientProvider client={view.client}>
      <HiveSummarySection sessionId="separate" onNavigateSession={vi.fn()} />
    </QueryClientProvider>,
  )
  await waitFor(() => expect(listHiveSessionCatalogPage).toHaveBeenCalledTimes(3))
  await act(async () => {
    resolvePage({ context: [queen], workers: [worker] })
    await pendingPage
  })
  expect(screen.queryByText(worker.title)).not.toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Hive' })).not.toBeInTheDocument()
})

it('reads the orchestration catalog and loads later direct workers only on demand', async () => {
  listHiveSessionCatalogPage
    .mockResolvedValueOnce({ context: [queen], workers: [], nextCursor: 'second-page' })
    .mockResolvedValueOnce({ context: [queen], workers: [worker] })
  const navigate = vi.fn()
  renderWithQueryClient(<HiveSummarySection sessionId="queen" onNavigateSession={navigate} />)

  expect(await screen.findByText('1 active · 2 total')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Hive/ })).toHaveAttribute('aria-expanded', 'true')
  expect(screen.queryByText(worker.title)).not.toBeInTheDocument()
  expect(listHiveSessionCatalogPage).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Load more workers' }))
  fireEvent.click(await screen.findByRole('button', { name: /Worker on page two/ }))
  expect(navigate).toHaveBeenCalledWith('worker')
  await waitFor(() =>
    expect(listHiveSessionCatalogPage).toHaveBeenLastCalledWith(queen.id, 50, 'second-page'),
  )
})
