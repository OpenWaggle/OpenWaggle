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
  VALID_OPEN_INPUT,
} from './terminal-handler-test-harness'

describe('registerTerminalHandlers', () => {
  beforeEach(resetTerminalHandlerTest)

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

  it.each([
    ['terminal:open', 'open', VALID_OPEN_INPUT],
    [
      'terminal:open',
      'open',
      {
        ...VALID_OPEN_INPUT,
        env: {
          OPENWAGGLE_PROJECT_ROOT: '/tmp/project',
          OPENWAGGLE_WORKTREE_PATH: '/tmp/project',
        },
      },
    ],
    ['terminal:restart', 'restart', VALID_OPEN_INPUT],
  ] as const)(
    '%s decodes input, calls %s, and attaches the calling surface',
    async (channel, method, input) => {
      registerTerminalHandlers()
      const handler = getInvokeHandler(channel)

      const result = await handler?.(fakeEvent, input)

      expect(result).toEqual(FAKE_ATTACH_RESULT)
      expect(serviceMocks[method]).toHaveBeenCalledExactlyOnceWith(input)
      expect(serviceMocks.attachSurface).toHaveBeenCalledExactlyOnceWith(
        'session-1::main',
        FAKE_SURFACE_ID,
      )
    },
  )

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

  it.each([
    ['terminal:restart', [{ ...VALID_OPEN_INPUT, rows: TERMINAL.MAX_ROWS + 1 }], 'restart'],
    ['terminal:detach', ['', 'main'], 'detachTerminal'],
    ['terminal:clear', ['', 'main'], 'clear'],
    ['terminal:close', ['session-1', '', true], 'close'],
  ] as const)('%s refuses %j before calling %s', async (channel, args, method) => {
    registerTerminalHandlers()
    const handler = getInvokeHandler(channel)

    await expect(handler?.(fakeEvent, ...args)).rejects.toThrow()
    expect(serviceMocks[method]).not.toHaveBeenCalled()
    expect(serviceMocks.attachSurface).not.toHaveBeenCalled()
  })

  it.each([
    [
      'terminal:detach',
      ['session-1', 'main'],
      'detachTerminal',
      ['session-1', 'main', FAKE_SURFACE_ID],
    ],
    ['terminal:resize', ['session-1', 'main', 120, 40], 'resize', ['session-1', 'main', 120, 40]],
    [
      'terminal:resize',
      ['session-1', 'main', TERMINAL.MIN_COLS, TERMINAL.MIN_ROWS],
      'resize',
      ['session-1', 'main', TERMINAL.MIN_COLS, TERMINAL.MIN_ROWS],
    ],
    [
      'terminal:resize',
      ['session-1', 'main', TERMINAL.MAX_COLS, TERMINAL.MAX_ROWS],
      'resize',
      ['session-1', 'main', TERMINAL.MAX_COLS, TERMINAL.MAX_ROWS],
    ],
    ['terminal:clear', ['session-1', 'main'], 'clear', ['session-1', 'main']],
    ['terminal:close', ['session-1', 'main', true], 'close', ['session-1', 'main', true]],
    ['terminal:close', ['session-1', 'main', false], 'close', ['session-1', 'main', false]],
    ['terminal:assess-close', ['session-1', 'main'], 'assessClose', ['session-1', 'main']],
  ] as const)(
    '%s with %j calls %s for that terminal only',
    async (channel, args, method, expected) => {
      registerTerminalHandlers()
      const handler = getInvokeHandler(channel)

      await handler?.(fakeEvent, ...args)

      expect(serviceMocks[method]).toHaveBeenCalledExactlyOnceWith(...expected)
      expect(serviceMocks.detachSurface).not.toHaveBeenCalled()
    },
  )

  it('terminal:assess-close returns the main-process impact assessment', async () => {
    registerTerminalHandlers()
    const handler = getInvokeHandler('terminal:assess-close')

    await expect(handler?.(fakeEvent, 'session-1', 'main')).resolves.toEqual({
      disposition: 'confirm',
      reason: 'active',
      processNames: ['pnpm'],
      ports: [5173],
    })
  })

  it('terminal:resize rejects invalid dimensions', async () => {
    registerTerminalHandlers()
    const handler = getInvokeHandler('terminal:resize')
    const invalidDimensions: [number, number][] = [
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
})
