import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const warnings: string[] = []
  return {
    listeners: new Map<string, (event: unknown, ...args: unknown[]) => void>(),
    reportRendererEnvelope: vi.fn((_envelope: string) => undefined),
    warnings,
  }
})

vi.mock('../../desktop-shell/ipc-transport', () => ({
  ipcMainTransport: {
    handle: vi.fn(),
    on: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => {
      mocks.listeners.set(channel, listener)
    },
  },
}))
vi.mock('../../gui-runtime', () => ({
  runGuiEffect: (effect: Effect.Effect<unknown, unknown>) => Effect.runPromise(effect),
  runGuiEffectExit: (effect: Effect.Effect<unknown, unknown>) => Effect.runPromiseExit(effect),
}))
vi.mock('../../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: (message: string) => mocks.warnings.push(message),
    error: vi.fn(),
  }),
}))
// The Sentry SDK behind it is a vendor boundary; error-reporting.unit.test.ts covers the routing.
vi.mock('../../error-reporting', () => ({ reportRendererEnvelope: mocks.reportRendererEnvelope }))

import { registerErrorReportingHandlers } from '../error-reporting-handler'

describe('error-reporting:renderer-envelope', () => {
  it('hands an envelope to the reporter and refuses anything that is not one', async () => {
    registerErrorReportingHandlers()
    const listener = mocks.listeners.get('error-reporting:renderer-envelope')
    const envelope = '{}\n{"type":"event"}\n{}'

    listener?.({ sender: {} }, envelope)
    listener?.({ sender: {} }, { not: 'an envelope' })

    await vi.waitFor(() => expect(mocks.warnings).toHaveLength(1))
    expect(mocks.reportRendererEnvelope.mock.calls).toEqual([[envelope]])
  })
})
