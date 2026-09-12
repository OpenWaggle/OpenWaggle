import {
  inputs,
  scope,
  snapshot,
  values,
} from '@shared/schemas/__tests__/desktop-browser-service.test-fixtures'
import { decodeDesktopBrowserCommand } from '@shared/schemas/desktop-browser-service'
import { Effect, Exit, Fiber } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserPreviewAutomationServiceShape } from '../../ports/browser-preview-automation-service'
import { executeDesktopBrowserCommand } from '../desktop-browser-executor'

function localService(): BrowserPreviewAutomationServiceShape {
  return {
    status: vi.fn(() => Effect.succeed(values.status)),
    open: vi.fn(() => Effect.succeed(values.open)),
    navigate: vi.fn(() => Effect.succeed(values.navigate)),
    resize: vi.fn(() => Effect.succeed(values.resize)),
    setAppearance: vi.fn(() => Effect.succeed(values.setAppearance)),
    snapshot: vi.fn(() => Effect.succeed(values.snapshot)),
    click: vi.fn(() => Effect.void),
    type: vi.fn(() => Effect.void),
    press: vi.fn(() => Effect.void),
    scroll: vi.fn(() => Effect.void),
    evaluate: vi.fn(() => Effect.succeed(values.evaluate)),
    waitFor: vi.fn(() => Effect.void),
    startRecording: vi.fn(() => Effect.succeed(values.startRecording)),
    stopRecording: vi.fn(() => Effect.succeed(values.stopRecording)),
  }
}

describe('desktop browser executor', () => {
  it.each(Object.entries(inputs))(
    'dispatches %s to the local service with unchanged Host scope',
    async (operation, input) => {
      const service = localService()
      const command = decodeDesktopBrowserCommand({ service: 'browser', operation, scope, input })

      const result = await Effect.runPromise(executeDesktopBrowserCommand(service, command))

      expect(service[command.operation]).toHaveBeenCalledExactlyOnceWith(scope, input)
      expect(
        Object.values(service).filter((method) => vi.mocked(method).mock.calls.length > 0),
      ).toHaveLength(1)
      expect(result).toEqual({ service: 'browser', operation, value: values[command.operation] })
    },
  )

  it('rejects a mutated scoped command before touching local capabilities', async () => {
    const service = localService()
    const command = decodeDesktopBrowserCommand({
      service: 'browser',
      operation: 'open',
      scope,
      input: inputs.open,
    })
    Reflect.set(command.scope, 'workingPath', '/repo\0other')

    await expect(Effect.runPromise(executeDesktopBrowserCommand(service, command))).rejects.toThrow(
      'received an invalid command',
    )
    expect(service.open).not.toHaveBeenCalled()
  })

  it('reports a safe fixed error instead of including malformed page values', async () => {
    const secret = 'page contains credential=do-not-display'
    const service = {
      ...localService(),
      snapshot: () =>
        Effect.succeed({ ...snapshot, accessibilityTree: { text: secret, invalid: () => secret } }),
    }
    const command = decodeDesktopBrowserCommand({
      service: 'browser',
      operation: 'snapshot',
      scope,
      input: {},
    })
    const error = await Effect.runPromise(
      executeDesktopBrowserCommand(service, command).pipe(Effect.flip),
    )

    expect(error.message).toBe('Desktop browser service returned an invalid result.')
    expect(String(error)).not.toContain(secret)
    expect(error.cause).toBeUndefined()
  })

  it('preserves native policy failures without fabricating successful results', async () => {
    const denied = new Error('Browser access is disabled.')
    const service = { ...localService(), open: () => Effect.fail(denied) }
    const command = decodeDesktopBrowserCommand({
      service: 'browser',
      operation: 'open',
      scope,
      input: inputs.open,
    })
    const error = await Effect.runPromise(
      executeDesktopBrowserCommand(service, command).pipe(Effect.flip),
    )
    expect(error).toBe(denied)
  })

  it('interrupts in-flight browser work when the desktop request is cancelled', async () => {
    const interrupted = vi.fn()
    const started = Promise.withResolvers<void>()
    const service = {
      ...localService(),
      waitFor: () =>
        Effect.sync(() => started.resolve()).pipe(
          Effect.zipRight(Effect.never),
          Effect.onInterrupt(() => Effect.sync(interrupted)),
        ),
    }
    const command = decodeDesktopBrowserCommand({
      service: 'browser',
      operation: 'waitFor',
      scope,
      input: inputs.waitFor,
    })
    const fiber = Effect.runFork(executeDesktopBrowserCommand(service, command))
    await started.promise
    const exit = await Effect.runPromise(Fiber.interrupt(fiber))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(interrupted).toHaveBeenCalledOnce()
  })
})
