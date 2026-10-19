import { SessionId } from '@shared/types/brand'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { useWorkspacePanelStore } from '@/shell/workspace-panel-store'
import { archivedItemsQueryOptions, useArchivedDeleteSessionsMutation } from '../archived-sessions'

const deleteArchivedSessions = vi.hoisted(() => vi.fn())
vi.mock('@/shared/lib/ipc', () => ({
  api: {
    deleteArchivedSessions,
    unregisterBrowserPreviewOwner: vi.fn(async () => undefined),
    closeBrowserPreview: vi.fn(async () => undefined),
  },
}))

afterEach(() => {
  vi.restoreAllMocks()
  deleteArchivedSessions.mockReset()
  useWorkspacePanelStore.setState({ groups: {} })
})

function renderDeletion(client: QueryClient) {
  return renderHook(() => useArchivedDeleteSessionsMutation(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
}

it('cleans up the layout of deleted sessions only, and refreshes archived data', async () => {
  const deleted = SessionId('deleted')
  const restoredElsewhere = SessionId('restored-elsewhere')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const listKey = archivedItemsQueryOptions({}, 'recent').queryKey
  client.setQueryData(listKey, { pages: [], pageParams: [] })
  useWorkspacePanelStore.getState().showTerminal(deleted)
  useWorkspacePanelStore.getState().showTerminal(restoredElsewhere)
  deleteArchivedSessions.mockResolvedValue({
    deleted: [deleted],
    skipped: [restoredElsewhere],
    failed: [],
  })
  const { result, unmount } = renderDeletion(client)

  let outcome: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined
  await act(async () => {
    outcome = await result.current.mutateAsync([deleted, restoredElsewhere])
  })

  expect(deleteArchivedSessions).toHaveBeenCalledWith([deleted, restoredElsewhere])
  expect(outcome).toEqual({ deleted: [deleted], skipped: [restoredElsewhere], failed: [] })
  expect(useWorkspacePanelStore.getState().groups[deleted]).toBeUndefined()
  expect(useWorkspacePanelStore.getState().groups[restoredElsewhere]).toBeDefined()
  expect(client.getQueryState(listKey)?.isInvalidated).toBe(true)
  unmount()
  client.clear()
})

it('counts a deleted session as deleted when its layout cleanup fails, and reports it', async () => {
  const id = SessionId('deleted-with-full-storage')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  useWorkspacePanelStore.getState().showTerminal(id)
  const storage = useWorkspacePanelStore.persist.getOptions().storage
  if (!storage) throw new Error('Expected persisted Workspace panel storage')
  vi.spyOn(storage, 'setItem').mockImplementation(() => {
    throw new DOMException('Workspace storage is full', 'QuotaExceededError')
  })
  deleteArchivedSessions.mockResolvedValue({ deleted: [id], skipped: [], failed: [] })
  const { result, unmount } = renderDeletion(client)

  let outcome: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined
  await act(async () => {
    outcome = await result.current.mutateAsync([id])
  })

  expect(outcome?.deleted).toEqual([id])
  expect(outcome?.failed).toEqual([{ sessionId: id, message: 'Workspace storage is full' }])
  unmount()
  client.clear()
})
