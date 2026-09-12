import { decodeDesktopBrowserResult } from '@shared/schemas/desktop-browser-service'
import type {
  DesktopBrowserCommand,
  DesktopBrowserResult,
} from '@shared/types/desktop-browser-service'
import { Effect, Layer } from 'effect'
import {
  BrowserPreviewAutomationService,
  type BrowserPreviewAutomationServiceShape,
} from '../ports/browser-preview-automation-service'
import {
  DesktopServiceBroker,
  type DesktopServiceBrokerShape,
} from '../ports/desktop-service-broker'

const INVALID_BROWSER_RESPONSE = 'Desktop browser service returned an invalid response.'

function unexpectedOperation(): never {
  throw new Error(INVALID_BROWSER_RESPONSE)
}

/** The Session Host delegates browser work to the authenticated desktop owner. */
export function makeRemoteBrowserPreviewAutomationService(
  broker: DesktopServiceBrokerShape,
): BrowserPreviewAutomationServiceShape {
  function execute<Value>(
    command: DesktopBrowserCommand,
    select: (result: DesktopBrowserResult) => Value,
  ) {
    return broker.execute(command).pipe(
      Effect.flatMap((response) =>
        Effect.try({
          try: () => select(decodeDesktopBrowserResult(response)),
          catch: () => new Error(INVALID_BROWSER_RESPONSE),
        }),
      ),
    )
  }

  return {
    status: (scope, input) =>
      execute({ service: 'browser', operation: 'status', scope, input }, (result) =>
        result.operation === 'status' ? result.value : unexpectedOperation(),
      ),
    open: (scope, input) =>
      execute({ service: 'browser', operation: 'open', scope, input }, (result) =>
        result.operation === 'open' ? result.value : unexpectedOperation(),
      ),
    navigate: (scope, input) =>
      execute({ service: 'browser', operation: 'navigate', scope, input }, (result) =>
        result.operation === 'navigate' ? result.value : unexpectedOperation(),
      ),
    resize: (scope, input) =>
      execute({ service: 'browser', operation: 'resize', scope, input }, (result) =>
        result.operation === 'resize' ? result.value : unexpectedOperation(),
      ),
    setAppearance: (scope, input) =>
      execute({ service: 'browser', operation: 'setAppearance', scope, input }, (result) =>
        result.operation === 'setAppearance' ? result.value : unexpectedOperation(),
      ),
    snapshot: (scope, input) =>
      execute({ service: 'browser', operation: 'snapshot', scope, input }, (result) =>
        result.operation === 'snapshot' ? result.value : unexpectedOperation(),
      ),
    click: (scope, input) =>
      execute({ service: 'browser', operation: 'click', scope, input }, (result) =>
        result.operation === 'click' ? undefined : unexpectedOperation(),
      ),
    type: (scope, input) =>
      execute({ service: 'browser', operation: 'type', scope, input }, (result) =>
        result.operation === 'type' ? undefined : unexpectedOperation(),
      ),
    press: (scope, input) =>
      execute({ service: 'browser', operation: 'press', scope, input }, (result) =>
        result.operation === 'press' ? undefined : unexpectedOperation(),
      ),
    scroll: (scope, input) =>
      execute({ service: 'browser', operation: 'scroll', scope, input }, (result) =>
        result.operation === 'scroll' ? undefined : unexpectedOperation(),
      ),
    evaluate: (scope, input) =>
      execute({ service: 'browser', operation: 'evaluate', scope, input }, (result) =>
        result.operation === 'evaluate' ? result.value : unexpectedOperation(),
      ),
    waitFor: (scope, input) =>
      execute({ service: 'browser', operation: 'waitFor', scope, input }, (result) =>
        result.operation === 'waitFor' ? undefined : unexpectedOperation(),
      ),
    startRecording: (scope, input) =>
      execute({ service: 'browser', operation: 'startRecording', scope, input }, (result) =>
        result.operation === 'startRecording' ? result.value : unexpectedOperation(),
      ),
    stopRecording: (scope, input) =>
      execute({ service: 'browser', operation: 'stopRecording', scope, input }, (result) =>
        result.operation === 'stopRecording' ? result.value : unexpectedOperation(),
      ),
  }
}

export const RemoteBrowserPreviewAutomationServiceLive = Layer.effect(
  BrowserPreviewAutomationService,
  Effect.gen(function* () {
    return BrowserPreviewAutomationService.of(
      makeRemoteBrowserPreviewAutomationService(yield* DesktopServiceBroker),
    )
  }),
)
