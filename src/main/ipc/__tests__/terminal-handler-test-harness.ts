import type {
  TerminalAttachResult,
  TerminalInputIdentity,
  TerminalInputIntent,
  TerminalOpenInput,
} from '@shared/types/terminal'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { type Mock, vi } from 'vitest'
import { TerminalService } from '../../ports/terminal-service'

type GenericMock = Mock<(...args: unknown[]) => unknown>
type ServiceMocks = Readonly<
  Record<
    | 'open'
    | 'getActivitySnapshot'
    | 'write'
    | 'sendInputNow'
    | 'acknowledgeOutput'
    | 'migrateOwner'
    | 'resize'
    | 'clear'
    | 'restart'
    | 'assessClose'
    | 'close'
    | 'closeAllForOwner'
    | 'closeAllUnderPath'
    | 'attachSurface'
    | 'detachTerminal'
    | 'detachSurface'
    | 'closeAll',
    GenericMock
  >
>

const mocks = vi.hoisted(
  (): {
    readonly typedHandle: GenericMock
    readonly typedOn: GenericMock
    readonly service: ServiceMocks
  } => ({
    typedHandle: vi.fn<(...args: unknown[]) => unknown>(),
    typedOn: vi.fn<(...args: unknown[]) => unknown>(),
    service: {
      getActivitySnapshot: vi.fn<(...args: unknown[]) => unknown>(),
      open: vi.fn<(...args: unknown[]) => unknown>(),
      write: vi.fn<(...args: unknown[]) => unknown>(),
      sendInputNow: vi.fn<(...args: unknown[]) => unknown>(),
      acknowledgeOutput: vi.fn<(...args: unknown[]) => unknown>(),
      migrateOwner: vi.fn<(...args: unknown[]) => unknown>(),
      resize: vi.fn<(...args: unknown[]) => unknown>(),
      clear: vi.fn<(...args: unknown[]) => unknown>(),
      restart: vi.fn<(...args: unknown[]) => unknown>(),
      assessClose: vi.fn<(...args: unknown[]) => unknown>(),
      close: vi.fn<(...args: unknown[]) => unknown>(),
      closeAllForOwner: vi.fn<(...args: unknown[]) => unknown>(),
      closeAllUnderPath: vi.fn<(...args: unknown[]) => unknown>(),
      attachSurface: vi.fn<(...args: unknown[]) => unknown>(),
      detachTerminal: vi.fn<(...args: unknown[]) => unknown>(),
      detachSurface: vi.fn<(...args: unknown[]) => unknown>(),
      closeAll: vi.fn<(...args: unknown[]) => unknown>(),
    },
  }),
)

export const typedHandleMock: GenericMock = mocks.typedHandle
export const typedOnMock: GenericMock = mocks.typedOn
export const serviceMocks: ServiceMocks = mocks.service

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
  typedOn: typedOnMock,
}))

vi.mock('../../runtime', () => ({
  runAppEffect: (effect: Effect.Effect<unknown, unknown, TerminalService>) =>
    Effect.runPromise(Effect.provide(effect, TestTerminalServiceLayer)),
}))

export const FAKE_SURFACE_ID = 42
export const FAKE_ATTACH_RESULT: TerminalAttachResult = {
  history: 'restored scrollback',
  outputBytes: 0,
  outputGeneration: 1,
  readiness: { phase: 'awaiting-prompt', generation: 1 },
  running: true,
  processName: 'pnpm',
  ports: [5173],
  projectActionPending: false,
}

function recordWrite(
  ownerKey: string,
  terminalId: string,
  data: string,
  identity: TerminalInputIdentity | undefined,
  intent: TerminalInputIntent | undefined,
) {
  if (identity === undefined && intent === undefined) {
    serviceMocks.write(ownerKey, terminalId, data)
    return
  }
  if (intent === undefined) {
    serviceMocks.write(ownerKey, terminalId, data, identity)
    return
  }
  serviceMocks.write(ownerKey, terminalId, data, identity, intent)
}

const TestTerminalServiceLayer = Layer.succeed(
  TerminalService,
  TerminalService.of({
    getActivitySnapshot: () => {
      serviceMocks.getActivitySnapshot()
      return Effect.succeed({
        revision: 7,
        summaries: [
          {
            ownerKey: 'session-1',
            terminalId: 'main',
            activityStatus: 'running',
            processName: 'pnpm',
            ports: [5173],
            projectActionPending: false,
          },
        ],
        truncated: false,
      })
    },
    open: (input) => {
      serviceMocks.open(input)
      return Effect.succeed(FAKE_ATTACH_RESULT)
    },
    write: (ownerKey, terminalId, data, identity, intent) => {
      recordWrite(ownerKey, terminalId, data, identity, intent)
      return Effect.succeed({
        status: 'queued' as const,
        acceptedBytes: data.length,
        ...(identity === undefined ? {} : { identity }),
      })
    },
    sendInputNow: (ownerKey, terminalId) => {
      serviceMocks.sendInputNow(ownerKey, terminalId)
      return Effect.succeed({ status: 'released', releasedBytes: 12 })
    },
    acknowledgeOutput: (ownerKey, terminalId, outputGeneration, endOffset) => {
      serviceMocks.acknowledgeOutput(ownerKey, terminalId, outputGeneration, endOffset)
      return Effect.void
    },
    migrateOwner: (fromOwnerKey, toOwnerKey) => {
      serviceMocks.migrateOwner(fromOwnerKey, toOwnerKey)
      return Effect.succeed({ terminalIds: ['main'] })
    },
    detachTerminal: (ownerKey, terminalId, surfaceId) => {
      serviceMocks.detachTerminal(ownerKey, terminalId, surfaceId)
      return Effect.void
    },
    resize: (ownerKey, terminalId, cols, rows) => {
      serviceMocks.resize(ownerKey, terminalId, cols, rows)
      return Effect.void
    },
    clear: (ownerKey, terminalId) => {
      serviceMocks.clear(ownerKey, terminalId)
      return Effect.void
    },
    restart: (input) => {
      serviceMocks.restart(input)
      return Effect.succeed(FAKE_ATTACH_RESULT)
    },
    assessClose: (ownerKey, terminalId) => {
      serviceMocks.assessClose(ownerKey, terminalId)
      return Effect.succeed({
        disposition: 'confirm',
        reason: 'active',
        processNames: ['pnpm'],
        ports: [5173],
      })
    },
    close: (ownerKey, terminalId, deleteHistory) => {
      serviceMocks.close(ownerKey, terminalId, deleteHistory)
      return Effect.void
    },
    closeAllForOwner: (ownerKey, deleteHistory) => {
      serviceMocks.closeAllForOwner(ownerKey, deleteHistory)
      return Effect.void
    },
    closeAllUnderPath: (directoryPath, deleteHistory) => {
      serviceMocks.closeAllUnderPath(directoryPath, deleteHistory)
      return Effect.void
    },
    runWithMutationFence: (_scope, operation) => operation,
    attachSurface: (terminalKey, surfaceId) => {
      serviceMocks.attachSurface(terminalKey, surfaceId)
      return Effect.void
    },
    detachSurface: (surfaceId) => {
      serviceMocks.detachSurface(surfaceId)
      return Effect.void
    },
    closeAll: () => {
      serviceMocks.closeAll()
      return Effect.void
    },
  }),
)

export const VALID_OPEN_INPUT: TerminalOpenInput = {
  ownerKey: 'session-1',
  terminalId: 'main',
  cwd: '/tmp/openwaggle-workspace',
  cols: 120,
  rows: 40,
}

export const fakeEvent = { sender: { id: FAKE_SURFACE_ID } }

export function getInvokeHandler(name: string) {
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === name && typeof candidate[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') return undefined
  return (...args: unknown[]) =>
    Effect.runPromise(Effect.provide(handler(...args), TestTerminalServiceLayer))
}

export function getSendHandler(name: string) {
  const call = typedOnMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === name && typeof candidate[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') return undefined
  return (...args: unknown[]) =>
    Effect.runPromise(Effect.provide(handler(...args), TestTerminalServiceLayer))
}

export function resetTerminalHandlerTest() {
  typedHandleMock.mockReset()
  typedOnMock.mockReset()
  for (const mock of Object.values(serviceMocks)) mock.mockReset()
}

const terminalHandler = await import('../terminal-handler')

export const cleanupTerminals = terminalHandler.cleanupTerminals
export const registerTerminalHandlers = terminalHandler.registerTerminalHandlers
