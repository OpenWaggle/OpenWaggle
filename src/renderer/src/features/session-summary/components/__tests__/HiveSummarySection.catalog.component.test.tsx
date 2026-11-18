import { SessionId } from '@shared/types/brand'
import { screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
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
  listHiveSessionCatalogPage.mockReset()
})

it('summarizes from the Host counts without listing Workers or paging', async () => {
  listHiveSessionCatalogPage.mockResolvedValueOnce({
    context: [queen],
    workers: [worker],
  })
  renderWithQueryClient(<HiveSummarySection sessionId="queen" />)

  // The Host's direct-Worker count is exact before any later page loads; the group counts come
  // from the Workers read so far, so they are marked as lower bounds.
  expect(await screen.findByRole('region', { name: 'Hive' })).toHaveTextContent(
    '2 direct Workers · 1+ working',
  )
  expect(screen.queryByText('Worker on page two')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Load more workers' })).toBeNull()
  expect(
    screen.getByRole('button', { name: 'Open Hive panel, 2 direct Workers, 1+ working' }),
  ).toBeInTheDocument()
})

it('does not fetch further pages after the first', async () => {
  listHiveSessionCatalogPage.mockResolvedValueOnce({
    context: [queen],
    workers: [],
  })
  renderWithQueryClient(<HiveSummarySection sessionId="queen" />)

  expect(await screen.findByRole('region', { name: 'Hive' })).toBeInTheDocument()
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(listHiveSessionCatalogPage).toHaveBeenCalledTimes(1)
})
