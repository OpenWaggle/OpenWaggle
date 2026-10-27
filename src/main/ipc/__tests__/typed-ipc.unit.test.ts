import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import type { IpcMainInvokeEvent } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ValidationIssuesError } from '../../errors'

const { invokeConfiguredHostUiRawMock, ipcMainHandleMock, ipcMainOnMock, warnings } = vi.hoisted(
  () => {
    const logged: { readonly message: string; readonly data: unknown }[] = []
    return {
      invokeConfiguredHostUiRawMock: vi.fn(),
      ipcMainHandleMock: vi.fn(),
      ipcMainOnMock: vi.fn(),
      warnings: logged,
    }
  },
)

vi.mock('../../application/gui-session-command-router', () => ({
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
    warn: (message: string, data: unknown) => warnings.push({ message, data }),
    error: vi.fn(),
  }),
}))

vi.mock('../../gui-runtime', () => ({
  runGuiEffect: (effect: Effect.Effect<unknown, unknown, never>) => Effect.runPromise(effect),
  runGuiEffectExit: (effect: Effect.Effect<unknown, unknown, never>) =>
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
    typedOn(
      'terminal:ack-output',
      (_event, _ownerKey, _terminalId, _generation, _offset) => Effect.void,
    )

    expect(ipcMainOnMock).toHaveBeenCalledOnce()
    expect(ipcMainOnMock).toHaveBeenCalledWith('terminal:ack-output', expect.any(Function))
  })

  it('runs the effect handler when the listener fires', async () => {
    const effectBody = vi.fn()
    typedOn('terminal:ack-output', () => Effect.sync(() => effectBody()))

    const registeredListener = ipcMainOnMock.mock.calls[0][1]
    const fakeEvent = { sender: {} }
    await registeredListener(fakeEvent, 'owner', 'terminal-id', 1, 42)

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

  it('forwards prepared transport arguments to the Session Host', async () => {
    invokeConfiguredHostUiRawMock.mockResolvedValue({ handled: true, result: { ok: true } })
    hostHandle('settings:update', {
      prepareRemoteArgs: (_event, update) => [{ approved: update }],
    })
    const registeredHandler = ipcMainHandleMock.mock.calls[0][1]

    await expect(registeredHandler({ sender: {} }, { thinkingLevel: 'high' })).resolves.toEqual({
      ok: true,
    })
    expect(invokeConfiguredHostUiRawMock).toHaveBeenCalledWith('settings:update', [
      { approved: { thinkingLevel: 'high' } },
    ])
  })

  it('answers nothing itself when the window is not attached to a Session Host (A-F5)', async () => {
    invokeConfiguredHostUiRawMock.mockResolvedValue({ handled: false })
    hostHandle('settings:get')
    const registeredHandler = ipcMainHandleMock.mock.calls[0][1]

    await expect(registeredHandler({ sender: {} })).rejects.toThrow(
      '"settings:get" needs the Session Host',
    )
  })

  it('routes worktree removal to the authoritative Host for an attached GUI', async () => {
    invokeConfiguredHostUiRawMock.mockResolvedValue({
      handled: true,
      result: { ok: false, code: 'workspace-bound', message: 'Still bound.' },
    })
    hostHandle('git:worktrees:remove')
    const registeredHandler = ipcMainHandleMock.mock.calls[0][1]

    await expect(
      registeredHandler({ sender: {} }, '/project', { path: '/worktree' }),
    ).resolves.toEqual({ ok: false, code: 'workspace-bound', message: 'Still bound.' })
    expect(invokeConfiguredHostUiRawMock).toHaveBeenCalledWith('git:worktrees:remove', [
      '/project',
      { path: '/worktree' },
    ])
  })
})

describe('hostHandle follow-up after the Session Host answered', () => {
  beforeEach(() => {
    invokeConfiguredHostUiRawMock.mockReset()
    ipcMainHandleMock.mockReset()
    warnings.length = 0
  })

  it('runs the follow-up with the Host result and the original arguments', async () => {
    invokeConfiguredHostUiRawMock.mockResolvedValue({ handled: true, result: { ok: true } })
    const followUps: unknown[] = []
    hostHandle('settings:update', {
      afterRemote: (result, update) => Effect.sync(() => void followUps.push({ result, update })),
    })
    const registeredHandler = ipcMainHandleMock.mock.calls[0][1]

    await expect(
      registeredHandler({ sender: {} }, { usageStatisticsEnabled: false }),
    ).resolves.toEqual({ ok: true })
    expect(followUps).toEqual([{ result: { ok: true }, update: { usageStatisticsEnabled: false } }])
  })

  it('returns the Host result and logs the channel when the follow-up fails', async () => {
    invokeConfiguredHostUiRawMock.mockResolvedValue({ handled: true, result: { ok: true } })
    hostHandle('settings:update', {
      afterRemote: () => Effect.fail(new Error('Session Host went away')),
    })
    const registeredHandler = ipcMainHandleMock.mock.calls[0][1]

    await expect(registeredHandler({ sender: {} }, {})).resolves.toEqual({ ok: true })
    expect(warnings).toEqual([
      {
        message: 'Host-backed IPC follow-up failed',
        data: { channel: 'settings:update', error: 'Session Host went away' },
      },
    ])
  })

  it('runs no follow-up when no Session Host answered', async () => {
    invokeConfiguredHostUiRawMock.mockResolvedValue({ handled: false })
    const followUps: unknown[] = []
    hostHandle('settings:update', {
      afterRemote: (result) => Effect.sync(() => void followUps.push(result)),
    })
    const registeredHandler = ipcMainHandleMock.mock.calls[0][1]

    await expect(registeredHandler({ sender: {} }, {})).rejects.toThrow('needs the Session Host')
    expect(followUps).toEqual([])
  })
})

describe('the backend gate (A-F2)', () => {
  beforeEach(async () => {
    ipcMainHandleMock.mockReset()
    ipcMainOnMock.mockReset()
    const { releaseGuiBackendGate } = await import('../../gui-backend-gate')
    releaseGuiBackendGate()
  })

  it('holds a renderer request registered before the backend is ready until it is', async () => {
    const { holdGuiBackendGate, releaseGuiBackendGate } = await import('../../gui-backend-gate')
    const body = vi.fn(() => '1.0.0')
    typedHandle('app:get-version', () => Effect.sync(body))
    const handler = ipcMainHandleMock.mock.calls[0]?.[1]
    if (typeof handler !== 'function') throw new Error('expected a registered handler')

    holdGuiBackendGate()
    const pending = handler(fromPartialEvent())
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(body).not.toHaveBeenCalled()

    releaseGuiBackendGate()
    await expect(pending).resolves.toBe('1.0.0')
    expect(body).toHaveBeenCalledOnce()
  })

  it('answers the startup status, Retry and the logs folder while the gate is held', async () => {
    const { holdGuiBackendGate } = await import('../../gui-backend-gate')
    holdGuiBackendGate()
    typedHandle('app:get-startup-status', () => Effect.succeed({ state: 'starting' as const }))
    const handler = ipcMainHandleMock.mock.calls[0]?.[1]
    if (typeof handler !== 'function') throw new Error('expected a registered handler')

    await expect(handler(fromPartialEvent())).resolves.toEqual({ state: 'starting' })
  })

  it('holds a one-way renderer message too', async () => {
    const { holdGuiBackendGate, releaseGuiBackendGate } = await import('../../gui-backend-gate')
    const body = vi.fn()
    typedOn('terminal:ack-output', () => Effect.sync(body))
    const listener = ipcMainOnMock.mock.calls[0]?.[1]
    if (typeof listener !== 'function') throw new Error('expected a registered listener')

    holdGuiBackendGate()
    listener(fromPartialEvent(), 'owner', 'terminal', 1, 0)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(body).not.toHaveBeenCalled()

    releaseGuiBackendGate()
    await vi.waitFor(() => expect(body).toHaveBeenCalledOnce())
  })
})

function fromPartialEvent(): IpcMainInvokeEvent {
  return fromPartial<IpcMainInvokeEvent>({})
}
