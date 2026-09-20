import type { SessionId } from '@shared/types/brand'
import type { PinnedSession, PinnedSessionMove } from '@shared/types/session'
import { type Mock, vi } from 'vitest'
import type * as SessionDetailsHandler from '../session-details-handler'
import { sessionDetailsCommandResponse } from './session-details-handler-command-response'

interface SessionDetailsHandlerMocks {
  readonly typedHandleMock: Mock
  readonly cleanupSessionRunMock: Mock
  readonly createRuntimeSessionMock: Mock<
    (input: { readonly projectPath: string }) => Promise<{
      readonly piSessionId: string
      readonly piSessionFile: string
    }>
  >
  readonly forkRuntimeSessionMock: Mock
  readonly persistSnapshotMock: Mock
  readonly listSessionDetailsMock: Mock
  readonly getSessionDetailMock: Mock
  readonly createSessionMock: Mock
  readonly deleteSessionMock: Mock
  readonly archiveSessionMock: Mock
  readonly unarchiveSessionMock: Mock
  readonly listArchivedSessionsMock: Mock
  readonly updateSessionTitleMock: Mock
  readonly setAuthorizationModeMock: Mock
  readonly listPinnedSessionsMock: Mock<() => Promise<readonly PinnedSession[]>>
  readonly pinSessionMock: Mock<(id: SessionId) => Promise<undefined>>
  readonly unpinSessionMock: Mock<(id: SessionId) => Promise<undefined>>
  readonly movePinnedSessionMock: Mock<(move: PinnedSessionMove) => Promise<undefined>>
  readonly cancelSessionRunsMock: Mock
  readonly waitForSessionRunsMock: Mock
  readonly clearAgentPhaseMock: Mock
  readonly clearStreamBufferMock: Mock
  readonly emitRunCompletedMock: Mock
  readonly dispatchLocalSessionCommandMock: Mock
  readonly deleteVisualizationSessionMock: Mock
  readonly rollbackVisualizationSessionDeletionMock: Mock
}

const mocks: SessionDetailsHandlerMocks = vi.hoisted(() => ({
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
  createSessionMock: vi.fn(),
  deleteSessionMock: vi.fn(),
  archiveSessionMock: vi.fn(),
  unarchiveSessionMock: vi.fn(),
  listArchivedSessionsMock: vi.fn(),
  updateSessionTitleMock: vi.fn(),
  setAuthorizationModeMock: vi.fn(),
  listPinnedSessionsMock: vi.fn<() => Promise<readonly PinnedSession[]>>(async () => []),
  pinSessionMock: vi.fn(async (_id: SessionId) => undefined),
  unpinSessionMock: vi.fn(async (_id: SessionId) => undefined),
  movePinnedSessionMock: vi.fn(async (_move: PinnedSessionMove) => undefined),
  cancelSessionRunsMock: vi.fn(),
  waitForSessionRunsMock: vi.fn(),
  clearAgentPhaseMock: vi.fn(),
  clearStreamBufferMock: vi.fn(),
  emitRunCompletedMock: vi.fn(),
  dispatchLocalSessionCommandMock: vi.fn(),
  deleteVisualizationSessionMock: vi.fn(),
  rollbackVisualizationSessionDeletionMock: vi.fn(),
}))

export const {
  typedHandleMock,
  cleanupSessionRunMock,
  createRuntimeSessionMock,
  forkRuntimeSessionMock,
  listSessionDetailsMock,
  getSessionDetailMock,
  createSessionMock,
  deleteSessionMock,
  archiveSessionMock,
  setAuthorizationModeMock,
  cancelSessionRunsMock,
  waitForSessionRunsMock,
  clearAgentPhaseMock,
  clearStreamBufferMock,
  emitRunCompletedMock,
  dispatchLocalSessionCommandMock,
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
}: SessionDetailsHandlerMocks = mocks

vi.mock('../typed-ipc', () => ({ hostHandle: typedHandleMock }))
vi.mock('../../agent/session-cleanup', () => ({ cleanupSessionRun: cleanupSessionRunMock }))
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
vi.mock('../../application/local-session-command-dispatcher', () => ({
  dispatchLocalSessionCommand: dispatchLocalSessionCommandMock,
}))

export function resetSessionDetailsHandlerMocks() {
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
  dispatchLocalSessionCommandMock.mockImplementation(sessionDetailsCommandResponse)
}

export function loadSessionDetailsHandlers(): Promise<typeof SessionDetailsHandler> {
  return import('../session-details-handler')
}
