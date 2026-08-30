import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import type { IpcMainInvokeEvent } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ValidationIssuesError } from '../../errors'

const { invokeConfiguredHostUiRawMock, ipcMainHandleMock, ipcMainOnMock } = vi.hoisted(() => ({
  invokeConfiguredHostUiRawMock: vi.fn(),
  ipcMainHandleMock: vi.fn(),
  ipcMainOnMock: vi.fn(),
}))

vi.mock('../../application/local-session-command-dispatcher', () => ({
  invokeConfiguredHostUiRaw: invokeConfiguredHostUiRawMock,
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

import { hostHandle, typedHandle, typedOn } from '../typed-ipc'

function okResult(): { readonly ok: true } {
  return { ok: true }
}

describe('typedOn', () => {
  beforeEach(() => {
    invokeConfiguredHostUiRawMock.mockReset().mockResolvedValue({ handled: false })
    ipcMainHandleMock.mockReset()
    ipcMainOnMock.mockReset()
  })

  it('registers a listener on ipcMain.on with the given channel', () => {
    typedOn('terminal:write', (_event, _terminalId, _data) => Effect.void)

    expect(ipcMainOnMock).toHaveBeenCalledOnce()
    expect(ipcMainOnMock).toHaveBeenCalledWith('terminal:write', expect.any(Function))
  })

  it('runs the effect handler when the listener fires', async () => {
    const effectBody = vi.fn()
    typedOn('terminal:write', (_event, _terminalId, _data) => Effect.sync(() => effectBody()))

    const registeredListener = ipcMainOnMock.mock.calls[0][1]
    const fakeEvent = { sender: {} }
    await registeredListener(fakeEvent, 'terminal-id', 'input')

    expect(effectBody).toHaveBeenCalledOnce()
  })
})

describe('typedHandle', () => {
  beforeEach(() => {
    invokeConfiguredHostUiRawMock.mockReset().mockResolvedValue({ handled: false })
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
    const result = await registeredHandler(fakeEvent, { thinkingLevel: 'medium' })

    expect(result).toEqual({ ok: true })
  })

  it('maps ValidationIssuesError to a renderer-safe error', async () => {
    const handler = vi.fn().mockReturnValue(
      Effect.fail(
        new ValidationIssuesError({
          operation: 'settings:update',
          issues: ['selectedModel: Expected string'],
        }),
      ),
    )
    typedHandle('settings:update', handler)

    const registeredHandler = ipcMainHandleMock.mock.calls[0][1]
    const fakeEvent = { sender: {} }

    await expect(registeredHandler(fakeEvent, {})).rejects.toThrow(
      'Invalid arguments for "settings:update": selectedModel: Expected string',
    )
  })
})

describe('hostHandle', () => {
  beforeEach(() => {
    invokeConfiguredHostUiRawMock.mockReset()
    ipcMainHandleMock.mockReset()
    ipcMainOnMock.mockReset()
  })

  it('forwards prepared transport arguments and skips the isolated local runtime', async () => {
    invokeConfiguredHostUiRawMock.mockResolvedValue({ handled: true, result: { ok: true } })
    const localHandler = vi.fn(() => Effect.succeed({ ok: false as const, error: 'local' }))
    hostHandle('settings:update', localHandler, {
      prepareRemoteArgs: (_event, update) => [{ approved: update }],
    })
    const registeredHandler = ipcMainHandleMock.mock.calls[0][1]

    await expect(registeredHandler({ sender: {} }, { thinkingLevel: 'high' })).resolves.toEqual({
      ok: true,
    })
    expect(invokeConfiguredHostUiRawMock).toHaveBeenCalledWith('settings:update', [
      { approved: { thinkingLevel: 'high' } },
    ])
    expect(localHandler).not.toHaveBeenCalled()
  })

  it('uses the application effect when this GUI owns the Host', async () => {
    invokeConfiguredHostUiRawMock.mockResolvedValue({ handled: false })
    const localHandler = vi.fn(() => Effect.succeed(DEFAULT_SETTINGS))
    hostHandle('settings:get', localHandler)
    const registeredHandler = ipcMainHandleMock.mock.calls[0][1]

    await expect(registeredHandler({ sender: {} })).resolves.toEqual(DEFAULT_SETTINGS)
    expect(localHandler).toHaveBeenCalledOnce()
  })

  it('routes worktree removal to the authoritative Host for an attached GUI', async () => {
    invokeConfiguredHostUiRawMock.mockResolvedValue({
      handled: true,
      result: { ok: false, code: 'workspace-bound', message: 'Still bound.' },
    })
    const localHandler = vi.fn(() =>
      Effect.succeed({ ok: true as const, path: '/worktree', message: 'Removed.' }),
    )
    hostHandle('git:worktrees:remove', localHandler)
    const registeredHandler = ipcMainHandleMock.mock.calls[0][1]

    await expect(
      registeredHandler({ sender: {} }, '/project', { path: '/worktree' }),
    ).resolves.toEqual({ ok: false, code: 'workspace-bound', message: 'Still bound.' })
    expect(invokeConfiguredHostUiRawMock).toHaveBeenCalledWith('git:worktrees:remove', [
      '/project',
      { path: '/worktree' },
    ])
    expect(localHandler).not.toHaveBeenCalled()
  })
})
