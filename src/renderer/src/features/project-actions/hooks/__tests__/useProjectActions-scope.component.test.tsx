import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { actionCatalog } from '../../components/__tests__/native-action-fixtures'

const mocks = vi.hoisted(() => ({ manage: vi.fn(), useChat: vi.fn() }))
vi.mock('@/shared/lib/ipc', () => ({ api: { manageProjectActions: mocks.manage } }))
vi.mock('@/features/chat/hooks', () => ({ useChat: mocks.useChat }))

import { useProjectActionMutations, useProjectActions } from '../useProjectActions'

const projectPath = '/repo'
const projectScope = { projectPath }
function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function QueryWrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  const catalog = actionCatalog()
  mocks.useChat.mockReturnValue({
    activeSession: { id: 'active-worktree', projectPath },
  })
  mocks.manage.mockResolvedValue({ type: 'catalog', catalog })
})

it('reads and edits Settings shortcuts through the selected project despite an active worktree', async () => {
  const hook = renderHook(
    () => ({
      actions: useProjectActions(projectPath, projectScope),
      mutations: useProjectActionMutations(projectPath, projectScope),
    }),
    { wrapper: makeWrapper() },
  )
  await waitFor(() => expect(hook.result.current.actions.data).toHaveLength(1))
  await waitFor(() => expect(mocks.manage).toHaveBeenCalledTimes(2))
  await act(async () => {
    await hook.result.current.mutations.update('test', { shortcutRules: [] })
  })

  expect(mocks.manage).toHaveBeenCalledWith({
    scope: projectScope,
    operation: { type: 'edit', revision: 'catalog-1', edit: expect.any(Object) },
  })
  expect(mocks.manage.mock.calls.every(([request]) => request.scope.sessionId === undefined)).toBe(
    true,
  )
})

it('keeps runtime shortcut reads scoped to the active Session', async () => {
  renderHook(() => useProjectActions(projectPath), { wrapper: makeWrapper() })
  await waitFor(() =>
    expect(mocks.manage).toHaveBeenCalledWith({
      scope: { projectPath, sessionId: 'active-worktree' },
      operation: { type: 'catalog' },
    }),
  )
})
