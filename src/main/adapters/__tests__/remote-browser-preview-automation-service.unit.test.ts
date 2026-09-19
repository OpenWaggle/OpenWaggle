import {
  inputs,
  scope,
  values,
} from '@shared/schemas/__tests__/desktop-browser-service.test-fixtures'
import {
  decodeDesktopBrowserCommand,
  decodeDesktopBrowserResult,
} from '@shared/schemas/desktop-browser-service'
import type { DesktopBrowserOperation } from '@shared/types/desktop-browser-service'
import { fromPartial } from '@total-typescript/shoehorn'
import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserPreviewAutomationServiceShape } from '../../ports/browser-preview-automation-service'
import type { DesktopServiceBrokerShape } from '../../ports/desktop-service-broker'
import { makeRemoteBrowserPreviewAutomationService } from '../remote-browser-preview-automation-service'

const invocations: Readonly<
  Record<
    DesktopBrowserOperation,
    (service: BrowserPreviewAutomationServiceShape) => Effect.Effect<unknown, Error>
  >
> = {
  status: (service) => service.status(scope, inputs.status),
  open: (service) => service.open(scope, inputs.open),
  navigate: (service) => service.navigate(scope, inputs.navigate),
  resize: (service) => service.resize(scope, inputs.resize),
  setAppearance: (service) => service.setAppearance(scope, inputs.setAppearance),
  snapshot: (service) => service.snapshot(scope, inputs.snapshot),
  click: (service) => service.click(scope, inputs.click),
  type: (service) => service.type(scope, inputs.type),
  press: (service) => service.press(scope, inputs.press),
  scroll: (service) => service.scroll(scope, inputs.scroll),
  evaluate: (service) => service.evaluate(scope, inputs.evaluate),
  waitFor: (service) => service.waitFor(scope, inputs.waitFor),
  startRecording: (service) => service.startRecording(scope, inputs.startRecording),
  stopRecording: (service) => service.stopRecording(scope, inputs.stopRecording),
}

describe('remote browser automation proxy', () => {
  it.each(Object.entries(invocations))(
    'forwards %s only through the desktop broker',
    async (operation, invoke) => {
      const execute = vi.fn<DesktopServiceBrokerShape['execute']>((request) => {
        const command = decodeDesktopBrowserCommand(request)
        return Effect.succeed(
          decodeDesktopBrowserResult({
            service: 'browser',
            operation: command.operation,
            value: values[command.operation],
          }),
        )
      })
      const service = makeRemoteBrowserPreviewAutomationService(
        fromPartial<DesktopServiceBrokerShape>({ execute }),
      )

      const result = await Effect.runPromise(invoke(service))

      const command = decodeDesktopBrowserCommand(execute.mock.calls[0]?.[0])
      expect(execute).toHaveBeenCalledExactlyOnceWith({
        service: 'browser',
        operation,
        scope,
        input: inputs[command.operation],
      })
      expect(result).toEqual(
        values[command.operation] === null ? undefined : values[command.operation],
      )
    },
  )

  it('rejects a well-formed response for a different browser operation', async () => {
    const broker = fromPartial<DesktopServiceBrokerShape>({
      execute: () => Effect.succeed({ service: 'browser', operation: 'open', value: values.open }),
    })
    const service = makeRemoteBrowserPreviewAutomationService(broker)
    await expect(Effect.runPromise(service.status(scope, {}))).rejects.toThrow('invalid response')
  })

  it('does not expose a malformed browser response payload', async () => {
    const response = decodeDesktopBrowserResult({
      service: 'browser',
      operation: 'evaluate',
      value: null,
    })
    const secret = 'response credential=hidden'
    Reflect.set(response, 'value', { secret, invalid: () => secret })
    const broker = fromPartial<DesktopServiceBrokerShape>({
      execute: () => Effect.succeed(response),
    })
    const service = makeRemoteBrowserPreviewAutomationService(broker)
    const error = await Effect.runPromise(
      service.evaluate(scope, inputs.evaluate).pipe(Effect.flip),
    )
    expect(error.message).toBe('Desktop browser service returned an invalid response.')
    expect(String(error)).not.toContain(secret)
    expect(error.cause).toBeUndefined()
  })

  it('keeps a missing desktop unavailable instead of falling back to the headless Host', async () => {
    const unavailable = new Error('Desktop owner is unavailable.')
    const execute = vi.fn(() => Effect.fail(unavailable))
    const service = makeRemoteBrowserPreviewAutomationService(
      fromPartial<DesktopServiceBrokerShape>({ execute }),
    )
    expect(await Effect.runPromise(service.open(scope, inputs.open).pipe(Effect.flip))).toBe(
      unavailable,
    )
    expect(execute).toHaveBeenCalledOnce()
  })
})
