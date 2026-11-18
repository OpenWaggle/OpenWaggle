import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { actionCatalog } from '../../components/__tests__/native-action-fixtures'

const mocks = vi.hoisted(() => ({ manage: vi.fn() }))
vi.mock('@/shared/lib/ipc', () => ({ api: { manageProjectActions: mocks.manage } }))
vi.mock('@/features/chat/hooks', () => ({ useChat: vi.fn() }))

import { useWorkspaceActivityAvailable } from '../useWorkspaceActivityAvailable'

const scope = { projectPath: '/repo', sessionId: 'session' }
function mount(catalog = actionCatalog()) {
  mocks.manage.mockImplementation(({ operation }) => {
    if (operation.type === 'catalog') return Promise.resolve({ type: 'catalog', catalog })
    if (operation.type === 'runs') return Promise.resolve({ type: 'runs', runs: [] })
    return Promise.resolve({ type: 'preparation', preparation: null })
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(() => useWorkspaceActivityAvailable(scope), {
    wrapper: ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
}

describe('Workspace activity availability before the first run', () => {
  beforeEach(() => vi.clearAllMocks())

  it('offers setup on a fresh local Session before a preparation snapshot exists', async () => {
    const catalog = actionCatalog()
    const hook = mount({
      ...catalog,
      preparation: [
        {
          source: 'local',
          review: 'enabled',
          definition: {
            id: 'setup',
            profileId: 'default',
            phase: 'setup',
            invocation: { type: 'command', command: 'pnpm install', directory: '.' },
          },
        },
      ],
    })
    await waitFor(() => expect(hook.result.current).toBe(true))
  })

  it('offers profile selection before preparation has been selected', async () => {
    const catalog = actionCatalog()
    const hook = mount({
      ...catalog,
      profiles: [
        ...catalog.profiles,
        { source: 'local', definition: { id: 'custom', name: 'Custom' } },
      ],
    })
    await waitFor(() => expect(hook.result.current).toBe(true))
  })

  it('does not expose an empty hub for only the implicit default profile', async () => {
    const hook = mount()
    await waitFor(() => expect(mocks.manage).toHaveBeenCalledTimes(3))
    expect(hook.result.current).toBe(false)
  })
})
