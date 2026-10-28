/**
 * Requests the backend gate holds while startup runs (A-F2, R1 P3-5): one from a document that
 * reloaded or a window that closed meanwhile is dropped when the gate opens.
 */
import { EventEmitter } from 'node:events'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { ipcMainHandleMock, ipcMainOnMock } = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
  ipcMainOnMock: vi.fn(),
}))

vi.mock('../../application/gui-session-command-router', () => ({
  invokeConfiguredHostUiRaw: vi.fn(async () => ({ handled: false })),
}))
vi.mock('electron', () => ({ ipcMain: { handle: ipcMainHandleMock, on: ipcMainOnMock } }))
vi.mock('../../gui-runtime', () => ({
  runGuiEffect: (effect: Effect.Effect<unknown, unknown, never>) => Effect.runPromise(effect),
  runGuiEffectExit: (effect: Effect.Effect<unknown, unknown, never>) =>
    Effect.runPromiseExit(effect),
}))

import { holdGuiBackendGate, releaseGuiBackendGate } from '../../gui-backend-gate'
import { typedHandle, typedOn } from '../typed-ipc'

function okResult(): { readonly ok: true } {
  return { ok: true }
}

/** A window's webContents: it can reload (a new document) or close. */
class FakeSender extends EventEmitter {
  destroyed = false
  isDestroyed() {
    return this.destroyed
  }
}

describe('requests the backend gate holds while startup runs (A-F2)', () => {
  beforeEach(() => {
    ipcMainHandleMock.mockReset()
    ipcMainOnMock.mockReset()
    holdGuiBackendGate()
  })

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('runs a held request once the backend is ready, for the document that sent it', async () => {
    const handler = vi.fn(() => Effect.succeed(okResult()))
    typedHandle('settings:update', handler)
    const registeredHandler = ipcMainHandleMock.mock.calls[0][1]

    const result = registeredHandler({ sender: new FakeSender() }, {})
    await settle()
    expect(handler).not.toHaveBeenCalled()
    releaseGuiBackendGate()

    await expect(result).resolves.toEqual({ ok: true })
  })

  it('drops a held request whose window reloaded or closed before the backend was ready', async () => {
    const handler = vi.fn(() => Effect.succeed(okResult()))
    typedHandle('settings:update', handler)
    const registeredHandler = ipcMainHandleMock.mock.calls[0][1]
    const reloaded = new FakeSender()
    const closed = new FakeSender()

    const fromReloaded = registeredHandler({ sender: reloaded }, {})
    const fromClosed = registeredHandler({ sender: closed }, {})
    await settle()
    reloaded.emit('did-navigate')
    closed.destroyed = true
    releaseGuiBackendGate()

    await expect(fromReloaded).rejects.toThrow('closed or reloaded before startup finished')
    await expect(fromClosed).rejects.toThrow('closed or reloaded before startup finished')
    expect(handler).not.toHaveBeenCalled()
  })

  it('drops a held message whose window reloaded, and keeps one from a window that did not', async () => {
    const handled = vi.fn()
    typedOn('terminal:ack-output', (event) => Effect.sync(() => handled(event.sender)))
    const listener = ipcMainOnMock.mock.calls[0][1]
    const reloaded = new FakeSender()
    const unchanged = new FakeSender()

    listener({ sender: reloaded }, 'owner', 'terminal-id', 1, 42)
    listener({ sender: unchanged }, 'owner', 'terminal-id', 1, 42)
    reloaded.emit('render-process-gone')
    releaseGuiBackendGate()
    await settle()

    expect(handled.mock.calls).toEqual([[unchanged]])
  })

  it('writes the clipboard at once: it needs nothing of the backend', () => {
    const written = vi.fn()
    typedOn('clipboard:write-text', (_event, text) => Effect.sync(() => written(text)))
    const listener = ipcMainOnMock.mock.calls[0][1]

    listener({ sender: new FakeSender() }, 'copied')

    expect(written).toHaveBeenCalledWith('copied')
    releaseGuiBackendGate()
  })
})
