import { type Mock, vi } from 'vitest'
import type * as SessionDetailsHandler from '../session-details-handler'
import * as SessionResourceTest from './session-details-handler-resource-test-layer'

const mocks = vi.hoisted(
  (): Record<string, Mock> => ({
    typedHandleMock: vi.fn(),
    cleanupSessionRunMock: vi.fn(),
    createRuntimeSessionMock: vi.fn(async (_input: { readonly projectPath: string }) => ({
      piSessionId: 'pi-session-created',
      piSessionFile: '/tmp/pi-session-created.jsonl',
    })),
    forkRuntimeSessionMock: vi.fn(),
    persistSnapshotMock: vi.fn(),
    listSessionDetailsMock: vi.fn(),
    getSessionDetailMock: vi.fn(),
    getHiveRelationsMock: vi.fn(),
    getDeletionBlockerMock: vi.fn(async () => null),
    stageVisualizationSessionDeletionMock: vi.fn(),
    createSessionMock: vi.fn(),
    deleteSessionMock: vi.fn(),
    archiveSessionMock: vi.fn(),
    unarchiveSessionMock: vi.fn(),
    listArchivedSessionsMock: vi.fn(),
    updateSessionTitleMock: vi.fn(),
    setAuthorizationModeMock: vi.fn(),
    listPinnedSessionsMock: vi.fn(async () => []),
    pinSessionMock: vi.fn(async () => undefined),
    unpinSessionMock: vi.fn(async () => undefined),
    movePinnedSessionMock: vi.fn(async () => undefined),
    cancelSessionRunsMock: vi.fn(),
    waitForSessionRunsMock: vi.fn(),
    clearAgentPhaseMock: vi.fn(),
    clearStreamBufferMock: vi.fn(),
    emitRunCompletedMock: vi.fn(),
    deleteVisualizationSessionMock: vi.fn(),
    rollbackVisualizationSessionDeletionMock: vi.fn(),
  }),
)

export const {
  typedHandleMock,
  cleanupSessionRunMock,
  createRuntimeSessionMock,
  forkRuntimeSessionMock,
  listSessionDetailsMock,
  getSessionDetailMock,
  getHiveRelationsMock,
  getDeletionBlockerMock,
  stageVisualizationSessionDeletionMock,
  createSessionMock,
  deleteSessionMock,
  archiveSessionMock,
  setAuthorizationModeMock,
  cancelSessionRunsMock,
  waitForSessionRunsMock,
  clearAgentPhaseMock,
  clearStreamBufferMock,
  emitRunCompletedMock,
  deleteVisualizationSessionMock,
  rollbackVisualizationSessionDeletionMock,
  listArchivedSessionsMock,
  listPinnedSessionsMock,
  movePinnedSessionMock,
  persistSnapshotMock,
  pinSessionMock,
  unarchiveSessionMock,
  unpinSessionMock,
  updateSessionTitleMock,
} = mocks

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
}))

vi.mock('../../agent/session-cleanup', () => ({
  cleanupSessionRun: cleanupSessionRunMock,
}))

vi.mock('../active-agent-runs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../active-agent-runs')>()),
  cancelSessionRuns: cancelSessionRunsMock,
  waitForSessionRuns: waitForSessionRunsMock,
}))

vi.mock('../../utils/stream-bridge', () => ({
  clearAgentPhase: clearAgentPhaseMock,
  clearStreamBuffer: clearStreamBufferMock,
  emitRunCompleted: emitRunCompletedMock,
}))

export const completeSessionResourceCleanupMock =
  SessionResourceTest.completeSessionResourceCleanupMock
export const removeSessionResourcesMock = SessionResourceTest.removeSessionResourcesMock

export function resetSessionDetailsHandlerMocks() {
  SessionResourceTest.resetSessionResourceTestMocks()
  for (const mock of Object.values(mocks)) mock.mockReset()
  createRuntimeSessionMock.mockResolvedValue({
    piSessionId: 'pi-session-created',
    piSessionFile: '/tmp/pi-session-created.jsonl',
  })
  listPinnedSessionsMock.mockResolvedValue([])
  pinSessionMock.mockResolvedValue(undefined)
  unpinSessionMock.mockResolvedValue(undefined)
  movePinnedSessionMock.mockResolvedValue(undefined)
  cancelSessionRunsMock.mockReturnValue(false)
  waitForSessionRunsMock.mockResolvedValue(true)
  getDeletionBlockerMock.mockResolvedValue(null)
}

export function loadSessionDetailsHandlers(): Promise<typeof SessionDetailsHandler> {
  return import('../session-details-handler')
}
