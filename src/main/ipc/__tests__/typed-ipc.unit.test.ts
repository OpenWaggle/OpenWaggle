import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import type { ConversationId } from '@shared/types/brand'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
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
  runAppEffectExit: (effect: Effect.Effect<unknown, unknown, never>) =>
    Effect.runPromiseExit(effect),
}))

import { safeHandle, typedHandle, typedHandleEffect, typedOn } from '../typed-ipc'

function okResult(): { ok: true } {
  return { ok: true }
}

describe('typedHandle', () => {
  beforeEach(() => {
    ipcMainHandleMock.mockReset()
    ipcMainOnMock.mockReset()
  })

  it('registers a handler on ipcMain.handle with the given channel', () => {
    const handler = vi.fn(function handleSettingsGet(_event: IpcMainInvokeEvent) {
      return DEFAULT_SETTINGS
    })
    typedHandle('settings:get', handler)

    expect(ipcMainHandleMock).toHaveBeenCalledOnce()
    expect(ipcMainHandleMock).toHaveBeenCalledWith('settings:get', expect.any(Function))
  })
})

describe('typedOn', () => {
  beforeEach(() => {
    ipcMainHandleMock.mockReset()
    ipcMainOnMock.mockReset()
  })

  it('registers a listener on ipcMain.on with the given channel', () => {
    const listener = vi.fn(function onAgentCancel(
      _event: IpcMainEvent,
      _conversationId?: ConversationId,
    ) {})
    typedOn('agent:cancel', listener)

    expect(ipcMainOnMock).toHaveBeenCalledOnce()
    expect(ipcMainOnMock).toHaveBeenCalledWith('agent:cancel', expect.any(Function))
  })
})

describe('safeHandle', () => {
  beforeEach(() => {
    ipcMainHandleMock.mockReset()
    ipcMainOnMock.mockReset()
  })

  it('registers a handler on ipcMain.handle', () => {
    const handler = vi.fn(async function handleSettingsUpdate(
      _event: IpcMainInvokeEvent,
      _settings: Partial<Settings>,
    ) {
      return okResult()
    })
    safeHandle('settings:update', handler)

    expect(ipcMainHandleMock).toHaveBeenCalledOnce()
    expect(ipcMainHandleMock).toHaveBeenCalledWith('settings:update', expect.any(Function))
  })

  it('calls the handler and returns its result on success', async () => {
    const handler = vi.fn(async function handleSettingsUpdate(
      _event: IpcMainInvokeEvent,
      _settings: Partial<Settings>,
    ) {
      return okResult()
    })
    safeHandle('settings:update', handler)

    const registeredHandler = ipcMainHandleMock.mock.calls[0][1]
    const fakeEvent = { sender: {} }
    const result = await registeredHandler(fakeEvent, { executionMode: 'default-permissions' })

    expect(result).toEqual({ ok: true })
  })

  it('catches schema parse errors and re-throws with human-readable message', async () => {
    const handler = vi.fn(async function handleSettingsUpdate() {
      decodeUnknownOrThrow(
        Schema.Struct({
          apiKey: Schema.String,
        }),
        {
          apiKey: 42,
        },
      )
      return okResult()
    })
    safeHandle('settings:update', handler)

    const registeredHandler = ipcMainHandleMock.mock.calls[0][1]
    const fakeEvent = { sender: {} }

    await expect(registeredHandler(fakeEvent, {})).rejects.toThrow(
      'Invalid arguments for "settings:update"',
    )
  })

  it('includes schema issue paths in the re-thrown error message', async () => {
    const handler = vi.fn(async function handleSettingsUpdate() {
      decodeUnknownOrThrow(
        Schema.Struct({
          providers: Schema.Struct({
            anthropic: Schema.Struct({
              apiKey: Schema.String,
            }),
          }),
        }),
        {
          providers: {
            anthropic: {
              apiKey: 42,
            },
          },
        },
      )
      return okResult()
    })
    safeHandle('settings:update', handler)

    const registeredHandler = ipcMainHandleMock.mock.calls[0][1]
    const fakeEvent = { sender: {} }

    await expect(registeredHandler(fakeEvent, {})).rejects.toThrow(
      'providers.anthropic.apiKey: Expected string',
    )
  })

  it('re-throws non-validation errors unchanged', async () => {
    const genericError = new Error('Something went wrong')
    const handler = vi.fn(async function handleSettingsUpdate() {
      throw genericError
    })
    safeHandle('settings:update', handler)

    const registeredHandler = ipcMainHandleMock.mock.calls[0][1]
    const fakeEvent = { sender: {} }

    await expect(registeredHandler(fakeEvent, {})).rejects.toThrow('Something went wrong')
  })

  it('surfaces the first schema issue in the re-thrown error message', async () => {
    const handler = vi.fn(async function handleSettingsUpdate() {
      decodeUnknownOrThrow(
        Schema.Struct({
          field1: Schema.String,
          field2: Schema.Boolean,
        }),
        {
          field1: 1,
          field2: 'nope',
        },
      )
      return okResult()
    })
    safeHandle('settings:update', handler)

    const registeredHandler = ipcMainHandleMock.mock.calls[0][1]
    const fakeEvent = { sender: {} }

    await expect(registeredHandler(fakeEvent, {})).rejects.toThrow('field1: Expected string')
  })

  it('passes multiple arguments through to the handler', async () => {
    const handler = vi.fn(async function handleSettingsUpdate(
      _event: IpcMainInvokeEvent,
      _settings: Partial<Settings>,
    ) {
      return okResult()
    })
    safeHandle('settings:update', handler)

    const registeredHandler = ipcMainHandleMock.mock.calls[0][1]
    const fakeEvent = { sender: {} }
    await registeredHandler(fakeEvent, 'arg1', 'arg2')

    expect(handler).toHaveBeenCalledWith(fakeEvent, 'arg1', 'arg2')
  })
})

describe('typedHandleEffect', () => {
  beforeEach(() => {
    ipcMainHandleMock.mockReset()
    ipcMainOnMock.mockReset()
  })

  it('registers a handler on ipcMain.handle', () => {
    const handler = vi.fn(function handleSettingsGet(_event: IpcMainInvokeEvent) {
      return Effect.succeed(DEFAULT_SETTINGS)
    })
    typedHandleEffect('settings:get', handler)

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
    typedHandleEffect('settings:update', handler)

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
    typedHandleEffect('settings:update', handler)

    const registeredHandler = ipcMainHandleMock.mock.calls[0][1]
    const fakeEvent = { sender: {} }

    await expect(registeredHandler(fakeEvent, {})).rejects.toThrow(
      'Invalid arguments for "settings:update": providers.openai.apiKey: Expected string',
    )
  })
})
