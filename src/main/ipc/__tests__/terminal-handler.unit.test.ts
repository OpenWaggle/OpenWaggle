import { EventEmitter } from 'node:events'
import { TERMINAL } from '@shared/constants/resource-limits'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  FAKE_ATTACH_RESULT,
  FAKE_SURFACE_ID,
  fakeEvent,
  getInvokeHandler,
  registerTerminalHandlers,
  resetTerminalHandlerTest,
  serviceMocks,
  typedHandleMock,
  typedOnMock,
  VALID_OPEN_INPUT,
} from './terminal-handler-test-harness'

describe('registerTerminalHandlers', () => {
  beforeEach(resetTerminalHandlerTest)

  it('registers the session-terminal channel set', () => {
    registerTerminalHandlers()

    const invokeChannels = typedHandleMock.mock.calls.map((call: readonly unknown[]) => call[0])
    const sendChannels = typedOnMock.mock.calls.map((call: readonly unknown[]) => call[0])

    expect(invokeChannels).toEqual([
      'terminal:get-activity-snapshot',
      'terminal:open',
      'terminal:detach',
      'terminal:resize',
      'terminal:clear',
      'terminal:restart',
      'terminal:assess-close',
      'terminal:close',
      'terminal:write',
      'terminal:send-input-now',
      'terminal:migrate-owner',
    ])
    expect(sendChannels).toEqual(['terminal:ack-output'])
  })

  it('returns the bounded global terminal activity snapshot', async () => {
    registerTerminalHandlers()
    const handler = getInvokeHandler('terminal:get-activity-snapshot')

    await expect(handler?.(fakeEvent)).resolves.toEqual({
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
    expect(serviceMocks.getActivitySnapshot).toHaveBeenCalledOnce()
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

  it('detaches all watched terminals when a renderer reloads or dies', async () => {
    registerTerminalHandlers()
    const handler = getInvokeHandler('terminal:open')
    const sender = Object.assign(new EventEmitter(), { id: 77 })
    const event = { sender }

    await handler?.(event, VALID_OPEN_INPUT)
    await handler?.(event, VALID_OPEN_INPUT)
    expect(sender.listenerCount('did-start-loading')).toBe(1)

    sender.emit('did-start-loading')
    await Promise.resolve()
    expect(serviceMocks.detachSurface).toHaveBeenCalledWith(77)

    sender.emit('render-process-gone')
    await Promise.resolve()
    expect(serviceMocks.detachSurface).toHaveBeenCalledTimes(2)
  })

  it('terminal:open accepts bounded environment overrides', async () => {
    registerTerminalHandlers()
    const handler = getInvokeHandler('terminal:open')
    const input = {
      ...VALID_OPEN_INPUT,
      env: {
        OPENWAGGLE_PROJECT_ROOT: '/tmp/project',
        T3CODE_PROJECT_ROOT: '/tmp/project',
      },
    }

    await handler?.(fakeEvent, input)

    expect(serviceMocks.open).toHaveBeenCalledWith(input)
  })

  it('terminal:open rejects invalid launch contexts', async () => {
    registerTerminalHandlers()
    const handler = getInvokeHandler('terminal:open')
    const invalidInputs = [
      { ...VALID_OPEN_INPUT, ownerKey: '' },
      { ...VALID_OPEN_INPUT, terminalId: '' },
      { ...VALID_OPEN_INPUT, terminalId: 'pane::spoofed-owner' },
      { ...VALID_OPEN_INPUT, cols: TERMINAL.MAX_COLS + 1 },
      { ...VALID_OPEN_INPUT, cols: 80.5 },
      { ...VALID_OPEN_INPUT, rows: TERMINAL.MIN_ROWS - 1 },
      { ...VALID_OPEN_INPUT, cwd: '' },
      { ...VALID_OPEN_INPUT, cwd: 'relative/worktree' },
      { ...VALID_OPEN_INPUT, env: { 'BAD=NAME': 'value' } },
      { ...VALID_OPEN_INPUT, env: { NODE_OPTIONS: '--require /tmp/injected.cjs' } },
      { ...VALID_OPEN_INPUT, env: { VALID_NAME: 'value\0tail' } },
      {
        ...VALID_OPEN_INPUT,
        env: Object.fromEntries(
          Array.from({ length: TERMINAL.ENV_MAX_ENTRIES + 1 }, (_, index) => [
            `VALUE_${String(index)}`,
            'value',
          ]),
        ),
      },
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
    await expect(
      handler?.(fakeEvent, 's'.repeat(TERMINAL.OWNER_KEY_MAX_LENGTH + 1), 'main', 120, 40),
    ).rejects.toThrow()

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

  it('terminal:assess-close returns the main-process impact assessment', async () => {
    registerTerminalHandlers()
    const handler = getInvokeHandler('terminal:assess-close')

    await expect(handler?.(fakeEvent, 'session-1', 'main')).resolves.toEqual({
      disposition: 'confirm',
      reason: 'active',
      processNames: ['pnpm'],
      ports: [5173],
    })
    expect(serviceMocks.assessClose).toHaveBeenCalledWith('session-1', 'main')
  })

  it('terminal:close rejects an empty terminal id', async () => {
    registerTerminalHandlers()
    const handler = getInvokeHandler('terminal:close')

    await expect(handler?.(fakeEvent, 'session-1', '', true)).rejects.toThrow()
    expect(serviceMocks.close).not.toHaveBeenCalled()
  })
})
