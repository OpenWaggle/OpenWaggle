import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'

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

vi.mock('../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import { safeHandle, typedHandle, typedOn } from './typed-ipc'

describe('typedHandle', () => {
  beforeEach(() => {
    ipcMainHandleMock.mockReset()
    ipcMainOnMock.mockReset()
  })

  it('registers a handler on ipcMain.handle with the given channel', () => {
    const handler = vi.fn()
    typedHandle('settings:get' as never, handler as never)

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
    const listener = vi.fn()
    typedOn('agent:cancel' as never, listener as never)

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
    const handler = vi.fn()
    safeHandle('settings:update' as never, handler as never)

    expect(ipcMainHandleMock).toHaveBeenCalledOnce()
    expect(ipcMainHandleMock).toHaveBeenCalledWith('settings:update', expect.any(Function))
  })

  it('calls the handler and returns its result on success', async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true })
    safeHandle('settings:update' as never, handler as never)

    const registeredHandler = ipcMainHandleMock.mock.calls[0][1]
    const fakeEvent = { sender: {} }
    const result = await registeredHandler(fakeEvent, { executionMode: 'default-permissions' })

    expect(result).toEqual({ ok: true })
  })

  it('catches ZodError and re-throws with human-readable message', async () => {
    const zodError = new ZodError([
      {
        code: 'invalid_type',
        expected: 'string',
        path: ['apiKey'],
        message: 'Expected string, received number',
      },
    ])
    const handler = vi.fn().mockRejectedValue(zodError)
    safeHandle('settings:update' as never, handler as never)

    const registeredHandler = ipcMainHandleMock.mock.calls[0][1]
    const fakeEvent = { sender: {} }

    await expect(registeredHandler(fakeEvent, {})).rejects.toThrow(
      'Invalid arguments for "settings:update"',
    )
  })

  it('includes ZodError issue paths in the re-thrown error message', async () => {
    const zodError = new ZodError([
      {
        code: 'invalid_type',
        expected: 'string',
        path: ['providers', 'anthropic', 'apiKey'],
        message: 'Expected string',
      },
    ])
    const handler = vi.fn().mockRejectedValue(zodError)
    safeHandle('settings:update' as never, handler as never)

    const registeredHandler = ipcMainHandleMock.mock.calls[0][1]
    const fakeEvent = { sender: {} }

    await expect(registeredHandler(fakeEvent, {})).rejects.toThrow(
      'providers.anthropic.apiKey: Expected string',
    )
  })

  it('re-throws non-ZodError errors unchanged', async () => {
    const genericError = new Error('Something went wrong')
    const handler = vi.fn().mockRejectedValue(genericError)
    safeHandle('settings:update' as never, handler as never)

    const registeredHandler = ipcMainHandleMock.mock.calls[0][1]
    const fakeEvent = { sender: {} }

    await expect(registeredHandler(fakeEvent, {})).rejects.toThrow('Something went wrong')
  })

  it('handles multiple ZodError issues', async () => {
    const zodError = new ZodError([
      {
        code: 'invalid_type',
        expected: 'string',
        path: ['field1'],
        message: 'Expected string',
      },
      {
        code: 'invalid_type',
        expected: 'boolean',
        path: ['field2'],
        message: 'Expected boolean',
      },
    ])
    const handler = vi.fn().mockRejectedValue(zodError)
    safeHandle('settings:update' as never, handler as never)

    const registeredHandler = ipcMainHandleMock.mock.calls[0][1]
    const fakeEvent = { sender: {} }

    await expect(registeredHandler(fakeEvent, {})).rejects.toThrow(
      'field1: Expected string; field2: Expected boolean',
    )
  })

  it('passes multiple arguments through to the handler', async () => {
    const handler = vi.fn().mockResolvedValue(undefined)
    safeHandle('settings:update' as never, handler as never)

    const registeredHandler = ipcMainHandleMock.mock.calls[0][1]
    const fakeEvent = { sender: {} }
    await registeredHandler(fakeEvent, 'arg1', 'arg2')

    expect(handler).toHaveBeenCalledWith(fakeEvent, 'arg1', 'arg2')
  })
})
