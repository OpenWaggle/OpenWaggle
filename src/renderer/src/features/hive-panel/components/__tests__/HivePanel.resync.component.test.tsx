import { SessionId } from '@shared/types/brand'
import { act, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useSessionHiveInvalidation } from '@/features/session-summary'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { useHivePanelViewStore } from '../../state/hive-panel-view-store'
import { HivePanel } from '../HivePanel'

const { listHiveTreeSessionCatalogPage, onSessionHostEvent, onSessionHostResyncRequired } =
  vi.hoisted(() => ({
    listHiveTreeSessionCatalogPage: vi.fn(),
    onSessionHostEvent: vi.fn<(callback: (event: unknown) => void) => () => void>(),
    onSessionHostResyncRequired: vi.fn<(callback: () => void) => () => void>(),
  }))
vi.mock('@/shared/lib/ipc', () => ({
  api: { listHiveTreeSessionCatalogPage, onSessionHostEvent, onSessionHostResyncRequired },
}))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useNavigate: () => vi.fn(),
}))

const queen = { id: SessionId('queen'), title: 'Queen', createdAt: 1, updatedAt: 1 }
const worker = {
  id: SessionId('worker'),
  title: 'Worker',
  createdAt: 1,
  updatedAt: 1,
  lineage: {
    role: 'worker' as const,
    parentSessionId: queen.id,
    hiveRootSessionId: queen.id,
    directWorkerCount: 0,
    activeDirectWorkerCount: 0,
  },
}

function Harness() {
  useSessionHiveInvalidation()
  return <HivePanel sessionId="queen" onClose={vi.fn()} />
}

beforeEach(() => {
  // These cover the By state view; the tree view has its own tests.
  useHivePanelViewStore.setState({ view: 'by-state', showArchived: false, collapsed: {} })
  listHiveTreeSessionCatalogPage.mockReset()
  onSessionHostEvent.mockReset().mockReturnValue(vi.fn())
  onSessionHostResyncRequired.mockReset().mockReturnValue(vi.fn())
})

it('restarts the Hive tree at its first page after a Host resync', async () => {
  listHiveTreeSessionCatalogPage
    .mockResolvedValueOnce({ root: queen, members: [], needsYouCount: 0, nextCursor: 'tree-2' })
    .mockResolvedValueOnce({ root: queen, members: [worker], needsYouCount: 0 })
    .mockResolvedValueOnce({ root: queen, members: [worker], needsYouCount: 0 })
  renderWithQueryClient(<Harness />)
  // Read the second page, so there is a continuation page to discard.
  const loadMore = await screen.findByRole('button', { name: 'Load more Workers' })
  act(() => loadMore.click())
  await waitFor(() => expect(listHiveTreeSessionCatalogPage).toHaveBeenCalledTimes(2))

  await act(async () => {
    onSessionHostResyncRequired.mock.calls[0]?.[0]()
    await Promise.resolve()
  })
  await waitFor(() => expect(listHiveTreeSessionCatalogPage).toHaveBeenCalledTimes(3))
  expect(listHiveTreeSessionCatalogPage).toHaveBeenLastCalledWith(queen.id, 50, undefined)
})
