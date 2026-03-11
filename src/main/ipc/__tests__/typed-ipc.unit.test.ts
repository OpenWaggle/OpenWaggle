import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import type { IpcMainInvokeEvent } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ValidationIssuesError } from '../../errors'

const { ipcMainHandleMock, ipcMainOnMock } = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
  ipcMainOnMock: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcMainHandleMock,
    on: ipcMainOnMock,
  },
}))

vi.mock('../../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock('../../runtime', () => ({
  runAppEffect: (effect: Effect.Effect<unknown, unknown, never>) => Effect.runPromise(effect),
  runAppEffectExit: (effect: Effect.Effect<unknown, unknown, never>) =>
    Effect.runPromiseExit(effect),
}))

import { typedHandle, typedOn } from '../typed-ipc'

function okResult(): { ok: true } {
  return { ok: true }
}

describe('typedOn', () => {
  beforeEach(() => {
    ipcMainHandleMock.mockReset()
    ipcMainOnMock.mockReset()
  })

  it('registers a listener on ipcMain.on with the given channel', () => {
    typedOn('agent:cancel', (_event, _conversationId?) => Effect.void)

    expect(ipcMainOnMock).toHaveBeenCalledOnce()
    expect(ipcMainOnMock).toHaveBeenCalledWith('agent:cancel', expect.any(Function))
  })

  it('runs the effect handler when the listener fires', async () => {
    const effectBody = vi.fn()
    typedOn('agent:cancel', (_event, _conversationId?) => Effect.sync(() => effectBody()))

    const registeredListener = ipcMainOnMock.mock.calls[0][1]
    const fakeEvent = { sender: {} }
    await registeredListener(fakeEvent, 'test-id')

    expect(effectBody).toHaveBeenCalledOnce()
  })
})

describe('typedHandle', () => {
  beforeEach(() => {
    ipcMainHandleMock.mockReset()
    ipcMainOnMock.mockReset()
  })

  it('registers a handler on ipcMain.handle', () => {
    const handler = vi.fn(function handleSettingsGet(_event: IpcMainInvokeEvent) {
      return Effect.succeed(DEFAULT_SETTINGS)
    })
    typedHandle('settings:get', handler)

    expect(ipcMainHandleMock).toHaveBeenCalledOnce()
    expect(ipcMainHandleMock).toHaveBeenCalledWith('settings:get', expect.any(Function))
  })

  it('runs the effect handler and returns its result', async () => {
    const handler = vi.fn(function handleSettingsUpdate(
      _event: IpcMainInvokeEvent,
      _settings: Partial<Settings>,
    ) {
      return Effect.succeed(okResult())
    })
    typedHandle('settings:update', handler)

    const registeredHandler = ipcMainHandleMock.mock.calls[0][1]
    const fakeEvent = { sender: {} }
    const result = await registeredHandler(fakeEvent, { executionMode: 'default-permissions' })

    expect(result).toEqual({ ok: true })
  })

  it('maps ValidationIssuesError to a renderer-safe error', async () => {
    const handler = vi.fn().mockReturnValue(
      Effect.fail(
        new ValidationIssuesError({
          operation: 'settings:update',
          issues: ['providers.openai.apiKey: Expected string'],
        }),
      ),
    )
    typedHandle('settings:update', handler)

    const registeredHandler = ipcMainHandleMock.mock.calls[0][1]
    const fakeEvent = { sender: {} }

    await expect(registeredHandler(fakeEvent, {})).rejects.toThrow(
      'Invalid arguments for "settings:update": providers.openai.apiKey: Expected string',
    )
  })
})
