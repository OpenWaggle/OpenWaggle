import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRemoteSidebarSessions } from '../useRemoteSidebarSessions'

const apiMocks = vi.hoisted(() => ({
  listSessionsByIds: vi.fn(),
  querySessionControl: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMocks }))

function summary(id: string, title: string): SessionSummary {
  return {
    id: SessionId(id),
    title,
    projectPath: '/repo/project',
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('remote sidebar Session filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('finds a title beyond the loaded catalog page through Host discovery', async () => {
    const remote = summary('session-101', 'Needle Session')
    apiMocks.querySessionControl.mockResolvedValue({
      contractVersion: 2,
      requestId: 'search',
      outcome: {
        operation: 'search',
        sessions: [
          {
            sessionId: remote.id,
            title: remote.title,
            projectPath: remote.projectPath,
            archived: false,
            createdAt: 1,
            updatedAt: 1,
            lineageRole: 'independent',
            directWorkerCount: 0,
          },
        ],
      },
    })
    apiMocks.listSessionsByIds.mockResolvedValue([remote])

    const { result } = renderHook(() =>
      useRemoteSidebarSessions({
        query: 'needle',
        filterState: null,
        stateBySessionId: new Map(),
        loadedSessions: Array.from({ length: 100 }, (_, index) =>
          summary(`session-${index}`, `Loaded ${index}`),
        ),
        projectPaths: [],
        projectDisplayNames: {},
      }),
    )

    await waitFor(() => expect(result.current.sessions).toEqual([remote]))
    expect(apiMocks.querySessionControl).toHaveBeenCalledOnce()
    expect(apiMocks.listSessionsByIds).toHaveBeenCalledWith([remote.id])
  })

  it('hydrates a status match that has never been loaded in the sidebar', async () => {
    const remote = summary('session-error-101', 'Remote failure')
    apiMocks.listSessionsByIds.mockResolvedValue([remote])

    const { result } = renderHook(() =>
      useRemoteSidebarSessions({
        query: '',
        filterState: 'error',
        stateBySessionId: new Map([[String(remote.id), 'error']]),
        loadedSessions: [],
        projectPaths: [],
        projectDisplayNames: {},
      }),
    )

    await waitFor(() => expect(result.current.sessions).toEqual([remote]))
    expect(apiMocks.querySessionControl).not.toHaveBeenCalled()
  })
})
