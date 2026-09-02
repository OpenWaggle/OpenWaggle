import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSidebarProjectActions,
  type SidebarProjectActionDeps,
  sessionsInDeletionOrder,
} from '../sidebar-project-actions'

const apiMocks = vi.hoisted(() => ({
  archiveSession: vi.fn(),
  cancelAgent: vi.fn(),
  deleteSession: vi.fn(),
  listActiveRuns: vi.fn(),
  listSessionsByIds: vi.fn(),
  querySessionControl: vi.fn(),
  showConfirm: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMocks }))

const PROJECT_PATH = '/repo/project'

function summary(id: SessionId, archived = false): SessionSummary {
  return {
    id,
    title: String(id),
    projectPath: PROJECT_PATH,
    archived,
    createdAt: 1,
    updatedAt: 1,
  }
}

function deps() {
  return fromPartial<SidebarProjectActionDeps>({
    activeSessionId: null,
    clearTransientDraftContext: vi.fn(),
    displayProjectName: () => 'Project',
    expandProject: vi.fn(),
    loadChatSessions: vi.fn().mockResolvedValue(undefined),
    loadSessionTrees: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn(),
    projectPath: null,
    refreshGit: vi.fn(),
    removeProjectReferences: vi.fn().mockResolvedValue(undefined),
    selectFolder: vi.fn(),
    setProjectDisplayName: vi.fn(),
    setProjectPath: vi.fn(),
    showToast: vi.fn(),
    startDraftSession: vi.fn(),
  })
}

describe('sidebar project actions over paged catalogs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.archiveSession.mockResolvedValue(undefined)
    apiMocks.cancelAgent.mockResolvedValue(undefined)
    apiMocks.deleteSession.mockResolvedValue(undefined)
    apiMocks.listActiveRuns.mockResolvedValue([])
    apiMocks.showConfirm.mockResolvedValue(true)
  })

  it('archives every project Session without requiring sidebar preloading', async () => {
    const ids = Array.from({ length: 129 }, (_, index) => SessionId(`session-${index}`))
    apiMocks.querySessionControl.mockImplementation(
      async (request: { query: { archived?: boolean; cursor?: string } }) => ({
        contractVersion: 2,
        requestId: 'paged-project-sessions',
        outcome: {
          operation: 'list',
          sessions: request.query.archived
            ? []
            : (request.query.cursor ? ids.slice(100) : ids.slice(0, 100)).map((id) => ({
                sessionId: id,
                title: String(id),
                projectPath: PROJECT_PATH,
                archived: false,
                createdAt: 1,
                updatedAt: 1,
                lineageRole: 'independent' as const,
                directWorkerCount: 0,
              })),
          ...(!request.query.archived && !request.query.cursor ? { nextCursor: 'page-2' } : {}),
        },
      }),
    )
    apiMocks.listSessionsByIds.mockImplementation(async (pageIds: readonly SessionId[]) =>
      pageIds.map((id) => summary(id)),
    )
    let inFlight = 0
    let peakInFlight = 0
    apiMocks.archiveSession.mockImplementation(async () => {
      inFlight += 1
      peakInFlight = Math.max(peakInFlight, inFlight)
      await Promise.resolve()
      inFlight -= 1
    })
    const actions = createSidebarProjectActions(deps())

    actions.archiveSessions(PROJECT_PATH, [])

    await vi.waitFor(() => expect(apiMocks.archiveSession).toHaveBeenCalledTimes(129))
    expect(apiMocks.showConfirm).toHaveBeenCalledWith(
      expect.stringContaining('Archive 129 sessions'),
      'Project: Project',
    )
    expect(peakInFlight).toBeLessThanOrEqual(8)
    expect(apiMocks.querySessionControl).toHaveBeenCalledTimes(3)
    expect(apiMocks.listSessionsByIds).toHaveBeenCalledTimes(2)
  })

  it('reports partial project mutations after attempting every Session', async () => {
    const ids = [SessionId('partial-a'), SessionId('partial-b'), SessionId('partial-c')]
    apiMocks.querySessionControl.mockImplementation(
      async (request: { query: { archived?: boolean } }) => ({
        contractVersion: 2,
        requestId: 'partial-project-sessions',
        outcome: {
          operation: 'list',
          sessions: request.query.archived
            ? []
            : ids.map((id) => ({
                sessionId: id,
                title: String(id),
                projectPath: PROJECT_PATH,
                archived: false,
                createdAt: 1,
                updatedAt: 1,
                lineageRole: 'independent' as const,
                directWorkerCount: 0,
              })),
        },
      }),
    )
    apiMocks.listSessionsByIds.mockResolvedValue(ids.map((id) => summary(id)))
    apiMocks.archiveSession.mockImplementation(async (id: SessionId) => {
      if (id === ids[1]) throw new Error('connection failed')
    })
    const dependencies = deps()
    const actions = createSidebarProjectActions(dependencies)

    actions.archiveSessions(PROJECT_PATH, [])

    await vi.waitFor(() => expect(apiMocks.archiveSession).toHaveBeenCalledTimes(3))
    await vi.waitFor(() =>
      expect(dependencies.showToast).toHaveBeenCalledWith(
        expect.stringContaining('2 of 3 operations completed; 1 failed'),
      ),
    )
  })

  it('hydrates active and archived pages before ordered project removal', async () => {
    const queenId = SessionId('queen')
    const workerId = SessionId('worker')
    apiMocks.querySessionControl.mockImplementation(
      async (request: { query: { archived?: boolean } }) => ({
        contractVersion: 2,
        requestId: 'remove-project-sessions',
        outcome: {
          operation: 'list',
          sessions: [
            {
              sessionId: request.query.archived ? workerId : queenId,
              title: request.query.archived ? 'Worker' : 'Queen',
              projectPath: PROJECT_PATH,
              archived: request.query.archived === true,
              createdAt: 1,
              updatedAt: 1,
              lineageRole: request.query.archived ? 'worker' : 'queen',
              directWorkerCount: request.query.archived ? 0 : 1,
            },
          ],
        },
      }),
    )
    apiMocks.listSessionsByIds.mockImplementation(async (ids: readonly SessionId[]) =>
      ids.map((id) =>
        id === workerId
          ? {
              ...summary(workerId, true),
              lineage: {
                role: 'worker' as const,
                parentSessionId: queenId,
                directWorkerCount: 0,
                activeDirectWorkerCount: 0,
              },
            }
          : summary(queenId),
      ),
    )
    apiMocks.listActiveRuns.mockResolvedValue([
      {
        sessionId: queenId,
        model: SupportedModelId('openai/gpt-5'),
        mode: 'classic',
        startedAt: 1,
      },
    ])
    const actionDeps = deps()
    const actions = createSidebarProjectActions(actionDeps)

    actions.remove(PROJECT_PATH)

    await vi.waitFor(() => expect(apiMocks.deleteSession).toHaveBeenCalledTimes(2))
    expect(apiMocks.cancelAgent).toHaveBeenCalledWith(queenId)
    expect(apiMocks.deleteSession).toHaveBeenNthCalledWith(1, workerId)
    expect(apiMocks.deleteSession).toHaveBeenNthCalledWith(2, queenId)
    expect(actionDeps.removeProjectReferences).toHaveBeenCalledWith(PROJECT_PATH)
  })

  it('orders an unlimited-depth Worker chain without using the call stack', () => {
    const depth = 20_000
    const sessions = Array.from({ length: depth }, (_, index): SessionSummary => {
      const id = SessionId(`deep-${index}`)
      return {
        ...summary(id),
        ...(index === 0
          ? {}
          : {
              lineage: {
                role: 'worker' as const,
                parentSessionId: SessionId(`deep-${index - 1}`),
                hiveRootSessionId: SessionId('deep-0'),
                directWorkerCount: index === depth - 1 ? 0 : 1,
                activeDirectWorkerCount: 0,
              },
            }),
      }
    })

    const ordered = sessionsInDeletionOrder(sessions)

    expect(ordered).toHaveLength(depth)
    expect(ordered[0]?.id).toBe(SessionId(`deep-${depth - 1}`))
    expect(ordered.at(-1)?.id).toBe(SessionId('deep-0'))
  })
})
