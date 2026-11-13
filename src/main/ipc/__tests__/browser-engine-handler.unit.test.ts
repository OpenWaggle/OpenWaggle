import type { BrowserEngineStatus } from '@shared/types/browser-engine'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const broadcast = vi.hoisted(() => vi.fn<(channel: string, ...args: unknown[]) => void>())
const engine = vi.hoisted(() => {
  const listeners: ((status: BrowserEngineStatus) => void)[] = []
  return {
    listeners,
    status: () => ({ type: 'checking' }),
    ensure: async () => {
      for (const listener of listeners) listener({ type: 'installing' })
      return { type: 'failed', reason: 'integrity', message: 'Checksum mismatch.' }
    },
    onStatus: (listener: (status: BrowserEngineStatus) => void) => {
      listeners.push(listener)
      return () => undefined
    },
  }
})

vi.mock('../../desktop-shell/ipc-transport', () => ({
  ipcMainTransport: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    },
    on: vi.fn(),
  },
}))
vi.mock('../../desktop-shell/browser-engine', () => ({ browserEngine: engine }))
vi.mock('../../utils/broadcast', () => ({ broadcastToWindows: broadcast }))
vi.mock('../../gui-runtime', () => ({
  runGuiEffect: (effect: Effect.Effect<unknown, unknown>) => Effect.runPromise(effect),
  runGuiEffectExit: (effect: Effect.Effect<unknown, unknown>) => Effect.runPromiseExit(effect),
}))

import { registerBrowserEngineHandlers } from '../browser-engine-handler'

function invoke(channel: string) {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`Missing handler for ${channel}.`)
  return handler({ sender: { id: 1 } })
}

describe('browser engine IPC handlers', () => {
  it('answers the status, ensures the engine and broadcasts every status change', async () => {
    registerBrowserEngineHandlers()

    await expect(invoke('browser-engine:get-status')).resolves.toEqual({ type: 'checking' })
    await expect(invoke('browser-engine:ensure')).resolves.toEqual({
      type: 'failed',
      reason: 'integrity',
      message: 'Checksum mismatch.',
    })
    expect(broadcast).toHaveBeenCalledWith('browser-engine:status-changed', { type: 'installing' })
  })
})
