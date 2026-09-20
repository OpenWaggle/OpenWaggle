import { SessionId } from '@shared/types/brand'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { useWorkspacePanelStore } from '@/shell/workspace-panel-store'
import { useArchivedDeleteSessionMutation } from '../archived-sessions'
import { queryKeys } from '../query-keys'

const deleteSession = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('@/shared/lib/ipc', () => ({
  api: {
    deleteSession,
    unregisterBrowserPreviewOwner: vi.fn(async () => undefined),
    closeBrowserPreview: vi.fn(async () => undefined),
  },
}))

afterEach(() => {
  vi.restoreAllMocks()
  deleteSession.mockReset()
  useWorkspacePanelStore.setState({ groups: {} })
})

it('does not invalidate committed data or clean layout when metadata deletion fails', async () => {
  const id = SessionId('blocked-delete')
  const client = new QueryClient()
  client.setQueryData(queryKeys.archivedSessions, [{ id }])
  client.setQueryData(queryKeys.sessionHive(id), { current: { id } })
  useWorkspacePanelStore.getState().showTerminal(id)
  const error = new Error('Active Workers must finish first')
  deleteSession.mockRejectedValueOnce(error)
  const { result, unmount } = renderHook(() => useArchivedDeleteSessionMutation(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
  await act(async () => {
    await expect(result.current.mutateAsync(id)).rejects.toBe(error)
  })
  expect(client.getQueryState(queryKeys.archivedSessions)?.isInvalidated).toBe(false)
  expect(client.getQueryState(queryKeys.sessionHive(id))?.isInvalidated).toBe(false)
  expect(useWorkspacePanelStore.getState().groups[id]).toBeDefined()
  unmount()
  client.clear()
})

it('invalidates archived and Hive data after committed deletion even when layout storage fails', async () => {
  const id = SessionId('deleted-with-full-storage')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(queryKeys.archivedSessions, [{ id }])
  client.setQueryData(queryKeys.sessionHive(id), { current: { id } })
  useWorkspacePanelStore.getState().showTerminal(id)
  const cleanupError = new DOMException('Workspace storage is full', 'QuotaExceededError')
  const storage = useWorkspacePanelStore.persist.getOptions().storage
  if (!storage) throw new Error('Expected persisted Workspace panel storage')
  vi.spyOn(storage, 'setItem').mockImplementation(() => {
    throw cleanupError
  })
  const { result, unmount } = renderHook(() => useArchivedDeleteSessionMutation(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })

  await act(async () => {
    await expect(result.current.mutateAsync(id)).rejects.toBe(cleanupError)
  })

  expect(deleteSession).toHaveBeenCalledWith(id)
  expect(client.getQueryState(queryKeys.archivedSessions)?.isInvalidated).toBe(true)
  expect(client.getQueryState(queryKeys.sessionHive(id))?.isInvalidated).toBe(true)
  unmount()
  client.clear()
})
