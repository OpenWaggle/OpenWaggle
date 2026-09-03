import { TERMINAL } from '@shared/constants/resource-limits'
import type { TerminalAttachResult, TerminalOpenInput } from '@shared/types/terminal'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalService } from '../../ports/terminal-service'

const typedHandleMock = vi.hoisted(() => vi.fn())
const typedOnMock = vi.hoisted(() => vi.fn())
const serviceMocks = vi.hoisted(() => ({
  open: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  clear: vi.fn(),
  restart: vi.fn(),
  close: vi.fn(),
  closeAllForOwner: vi.fn(),
  closeAllUnderPath: vi.fn(),
  attachSurface: vi.fn(),
  detachTerminal: vi.fn(),
  detachSurface: vi.fn(),
  closeAll: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
  typedOn: typedOnMock,
}))

vi.mock('../../runtime', () => ({
  runAppEffect: (effect: Effect.Effect<unknown, unknown, TerminalService>) =>
    Effect.runPromise(Effect.provide(effect, TestTerminalServiceLayer)),
}))

const FAKE_SURFACE_ID = 42
const FAKE_ATTACH_RESULT: TerminalAttachResult = {
  history: 'restored scrollback',
  outputBytes: 0,
  running: true,
}

const TestTerminalServiceLayer = Layer.succeed(
  TerminalService,
  TerminalService.of({
    open: (input) => {
      serviceMocks.open(input)
      return Effect.succeed(FAKE_ATTACH_RESULT)
    },
    write: (ownerKey, terminalId, data) => {
      serviceMocks.write(ownerKey, terminalId, data)
      return Effect.void
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

import { cleanupTerminals, registerTerminalHandlers } from '../terminal-handler'

const VALID_OPEN_INPUT: TerminalOpenInput = {
  ownerKey: 'session-1',
  terminalId: 'main',
  cwd: '/tmp/openwaggle-workspace',
  cols: 120,
  rows: 40,
}

const fakeEvent = { sender: { id: FAKE_SURFACE_ID } }

function getInvokeHandler(name: string) {
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === name && typeof candidate[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') return undefined
  return (...args: unknown[]) =>
    Effect.runPromise(Effect.provide(handler(...args), TestTerminalServiceLayer))
}

function getSendHandler(name: string) {
  const call = typedOnMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === name && typeof candidate[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') return undefined
  return (...args: unknown[]) =>
    Effect.runPromise(Effect.provide(handler(...args), TestTerminalServiceLayer))
}

describe('registerTerminalHandlers', () => {
  beforeEach(() => {
    typedHandleMock.mockReset()
    typedOnMock.mockReset()
    for (const mock of Object.values(serviceMocks)) mock.mockReset()
  })

  it('registers the session-terminal channel set', () => {
    registerTerminalHandlers()

    const invokeChannels = typedHandleMock.mock.calls.map((call: readonly unknown[]) => call[0])
    const sendChannels = typedOnMock.mock.calls.map((call: readonly unknown[]) => call[0])

    expect(invokeChannels).toEqual([
      'terminal:open',
      'terminal:detach',
      'terminal:resize',
      'terminal:clear',
      'terminal:restart',
      'terminal:close',
    ])
    expect(sendChannels).toEqual(['terminal:write'])
  })

  it('terminal:open decodes input, opens, and attaches the calling surface', async () => {
    registerTerminalHandlers()
    const handler = getInvokeHandler('terminal:open')

    const result = await handler?.(fakeEvent, VALID_OPEN_INPUT)

    expect(result).toEqual(FAKE_ATTACH_RESULT)
    expect(serviceMocks.open).toHaveBeenCalledOnce()
    expect(serviceMocks.open).toHaveBeenCalledWith(VALID_OPEN_INPUT)
    expect(serviceMocks.attachSurface).toHaveBeenCalledOnce()
    expect(serviceMocks.attachSurface).toHaveBeenCalledWith('session-1::main', FAKE_SURFACE_ID)
  })

  it('terminal:open rejects invalid launch contexts', async () => {
    registerTerminalHandlers()
    const handler = getInvokeHandler('terminal:open')
    const invalidInputs = [
      { ...VALID_OPEN_INPUT, ownerKey: '' },
      { ...VALID_OPEN_INPUT, terminalId: '' },
      { ...VALID_OPEN_INPUT, cols: TERMINAL.MAX_COLS + 1 },
      { ...VALID_OPEN_INPUT, cols: 80.5 },
      { ...VALID_OPEN_INPUT, rows: TERMINAL.MIN_ROWS - 1 },
      { ...VALID_OPEN_INPUT, cwd: '' },
    ]

    for (const input of invalidInputs) {
      await expect(handler?.(fakeEvent, input)).rejects.toThrow()
    }
    await expect(handler?.(fakeEvent, null)).rejects.toThrow()

    expect(serviceMocks.open).not.toHaveBeenCalled()
    expect(serviceMocks.attachSurface).not.toHaveBeenCalled()
  })

  it('terminal:restart restarts and re-attaches the calling surface', async () => {
    registerTerminalHandlers()
    const handler = getInvokeHandler('terminal:restart')

    const result = await handler?.(fakeEvent, VALID_OPEN_INPUT)

    expect(result).toEqual(FAKE_ATTACH_RESULT)
    expect(serviceMocks.restart).toHaveBeenCalledOnce()
    expect(serviceMocks.restart).toHaveBeenCalledWith(VALID_OPEN_INPUT)
    expect(serviceMocks.attachSurface).toHaveBeenCalledWith('session-1::main', FAKE_SURFACE_ID)
  })

  it('terminal:restart rejects rows above the maximum', async () => {
    registerTerminalHandlers()
    const handler = getInvokeHandler('terminal:restart')

    await expect(
      handler?.(fakeEvent, { ...VALID_OPEN_INPUT, rows: TERMINAL.MAX_ROWS + 1 }),
    ).rejects.toThrow()
    expect(serviceMocks.restart).not.toHaveBeenCalled()
    expect(serviceMocks.attachSurface).not.toHaveBeenCalled()
  })

  it('terminal:detach detaches the calling surface from that terminal only', async () => {
    registerTerminalHandlers()
    const handler = getInvokeHandler('terminal:detach')

    await handler?.(fakeEvent, 'session-1', 'main')

    expect(serviceMocks.detachTerminal).toHaveBeenCalledOnce()
    expect(serviceMocks.detachTerminal).toHaveBeenCalledWith('session-1', 'main', FAKE_SURFACE_ID)
    expect(serviceMocks.detachSurface).not.toHaveBeenCalled()
  })

  it('terminal:detach rejects an empty owner key without detaching', async () => {
    registerTerminalHandlers()
    const handler = getInvokeHandler('terminal:detach')

    await expect(handler?.(fakeEvent, '', 'main')).rejects.toThrow()
    expect(serviceMocks.detachSurface).not.toHaveBeenCalled()
  })

  it('terminal:resize resizes through the service including boundaries', async () => {
    registerTerminalHandlers()
    const handler = getInvokeHandler('terminal:resize')

    await handler?.(fakeEvent, 'session-1', 'main', 120, 40)
    await handler?.(fakeEvent, 'session-1', 'main', TERMINAL.MIN_COLS, TERMINAL.MIN_ROWS)
    await handler?.(fakeEvent, 'session-1', 'main', TERMINAL.MAX_COLS, TERMINAL.MAX_ROWS)

    expect(serviceMocks.resize).toHaveBeenCalledWith('session-1', 'main', 120, 40)
    expect(serviceMocks.resize).toHaveBeenCalledWith(
      'session-1',
      'main',
      TERMINAL.MIN_COLS,
      TERMINAL.MIN_ROWS,
    )
    expect(serviceMocks.resize).toHaveBeenCalledWith(
      'session-1',
      'main',
      TERMINAL.MAX_COLS,
      TERMINAL.MAX_ROWS,
    )
  })

  it('terminal:resize rejects invalid dimensions', async () => {
    registerTerminalHandlers()
    const handler = getInvokeHandler('terminal:resize')
    const invalidDimensions: Array<[number, number]> = [
      [TERMINAL.MIN_COLS - 1, 40],
      [TERMINAL.MAX_COLS + 1, 40],
      [120, TERMINAL.MIN_ROWS - 1],
      [120, TERMINAL.MAX_ROWS + 1],
      [120, 40.5],
    ]

    for (const [cols, rows] of invalidDimensions) {
      await expect(handler?.(fakeEvent, 'session-1', 'main', cols, rows)).rejects.toThrow()
    }
    await expect(handler?.(fakeEvent, 'session-1', '', 120, 40)).rejects.toThrow()

    expect(serviceMocks.resize).not.toHaveBeenCalled()
  })

  it('terminal:clear clears through the service', async () => {
    registerTerminalHandlers()
    const handler = getInvokeHandler('terminal:clear')

    await handler?.(fakeEvent, 'session-1', 'main')

    expect(serviceMocks.clear).toHaveBeenCalledOnce()
    expect(serviceMocks.clear).toHaveBeenCalledWith('session-1', 'main')
  })

  it('terminal:clear rejects an empty owner key', async () => {
    registerTerminalHandlers()
    const handler = getInvokeHandler('terminal:clear')

    await expect(handler?.(fakeEvent, '', 'main')).rejects.toThrow()
    expect(serviceMocks.clear).not.toHaveBeenCalled()
  })

  it('terminal:close passes the delete-history flag through', async () => {
    registerTerminalHandlers()
    const handler = getInvokeHandler('terminal:close')

    await handler?.(fakeEvent, 'session-1', 'main', true)
    await handler?.(fakeEvent, 'session-1', 'main', false)
    await handler?.(fakeEvent, 'session-1', 'main', undefined)

    expect(serviceMocks.close).toHaveBeenCalledWith('session-1', 'main', true)
    expect(serviceMocks.close).toHaveBeenCalledWith('session-1', 'main', false)
    expect(serviceMocks.close).toHaveBeenCalledTimes(3)
  })

  it('terminal:close rejects an empty terminal id', async () => {
    registerTerminalHandlers()
    const handler = getInvokeHandler('terminal:close')

    await expect(handler?.(fakeEvent, 'session-1', '', true)).rejects.toThrow()
    expect(serviceMocks.close).not.toHaveBeenCalled()
  })

  it('terminal:write writes valid input through the service', async () => {
    registerTerminalHandlers()
    const handler = getSendHandler('terminal:write')
    const maxInput = 'x'.repeat(TERMINAL.MAX_INPUT_BYTES)

    await handler?.(fakeEvent, 'session-1', 'main', 'echo hello')
    await handler?.(fakeEvent, 'session-1', 'main', maxInput)

    expect(serviceMocks.write).toHaveBeenCalledWith('session-1', 'main', 'echo hello')
    expect(serviceMocks.write).toHaveBeenCalledWith('session-1', 'main', maxInput)
    expect(serviceMocks.write).toHaveBeenCalledTimes(2)
  })

  it('terminal:write ignores oversized and empty input', async () => {
    registerTerminalHandlers()
    const handler = getSendHandler('terminal:write')
    const oversized = 'x'.repeat(TERMINAL.MAX_INPUT_BYTES + 1)

    await expect(handler?.(fakeEvent, 'session-1', 'main', oversized)).resolves.toBeUndefined()
    await handler?.(fakeEvent, 'session-1', 'main', '')

    expect(serviceMocks.write).not.toHaveBeenCalled()
  })

  it('cleanupTerminals closes every terminal on shutdown', async () => {
    registerTerminalHandlers()

    await cleanupTerminals()

    expect(serviceMocks.closeAll).toHaveBeenCalledOnce()
  })
})
