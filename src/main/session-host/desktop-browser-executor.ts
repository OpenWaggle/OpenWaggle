import { matchBy } from '@diegogbrisa/ts-match'
import {
  decodeDesktopBrowserCommand,
  decodeDesktopBrowserResult,
} from '@shared/schemas/desktop-browser-service'
import type {
  DesktopBrowserCommand,
  DesktopBrowserResult,
} from '@shared/types/desktop-browser-service'
import { Effect } from 'effect'
import type { BrowserPreviewAutomationServiceShape } from '../ports/browser-preview-automation-service'

/** Revalidate even typed commands before invoking an authority-bearing desktop service. */
export function executeDesktopBrowserCommand(
  service: BrowserPreviewAutomationServiceShape,
  command: DesktopBrowserCommand,
): Effect.Effect<DesktopBrowserResult, Error> {
  return Effect.try({
    try: () => decodeDesktopBrowserCommand(command),
    catch: () => new Error('Desktop browser service received an invalid command.'),
  }).pipe(
    Effect.flatMap((request) => {
      const response: Effect.Effect<unknown, Error> = matchBy(request, 'operation')
        .with('status', ({ scope, input }) =>
          service
            .status(scope, input)
            .pipe(Effect.map((value) => ({ service: 'browser', operation: 'status', value }))),
        )
        .with('open', ({ scope, input }) =>
          service
            .open(scope, input)
            .pipe(Effect.map((value) => ({ service: 'browser', operation: 'open', value }))),
        )
        .with('navigate', ({ scope, input }) =>
          service
            .navigate(scope, input)
            .pipe(Effect.map((value) => ({ service: 'browser', operation: 'navigate', value }))),
        )
        .with('resize', ({ scope, input }) =>
          service
            .resize(scope, input)
            .pipe(Effect.map((value) => ({ service: 'browser', operation: 'resize', value }))),
        )
        .with('setAppearance', ({ scope, input }) =>
          service
            .setAppearance(scope, input)
            .pipe(
              Effect.map((value) => ({ service: 'browser', operation: 'setAppearance', value })),
            ),
        )
        .with('snapshot', ({ scope, input }) =>
          service
            .snapshot(scope, input)
            .pipe(Effect.map((value) => ({ service: 'browser', operation: 'snapshot', value }))),
        )
        .with('click', ({ scope, input }) =>
          service
            .click(scope, input)
            .pipe(Effect.as({ service: 'browser', operation: 'click', value: null })),
        )
        .with('type', ({ scope, input }) =>
          service
            .type(scope, input)
            .pipe(Effect.as({ service: 'browser', operation: 'type', value: null })),
        )
        .with('press', ({ scope, input }) =>
          service
            .press(scope, input)
            .pipe(Effect.as({ service: 'browser', operation: 'press', value: null })),
        )
        .with('scroll', ({ scope, input }) =>
          service
            .scroll(scope, input)
            .pipe(Effect.as({ service: 'browser', operation: 'scroll', value: null })),
        )
        .with('evaluate', ({ scope, input }) =>
          service
            .evaluate(scope, input)
            .pipe(Effect.map((value) => ({ service: 'browser', operation: 'evaluate', value }))),
        )
        .with('waitFor', ({ scope, input }) =>
          service
            .waitFor(scope, input)
            .pipe(Effect.as({ service: 'browser', operation: 'waitFor', value: null })),
        )
        .with('startRecording', ({ scope, input }) =>
          service
            .startRecording(scope, input)
            .pipe(
              Effect.map((value) => ({ service: 'browser', operation: 'startRecording', value })),
            ),
        )
        .with('stopRecording', ({ scope, input }) =>
          service
            .stopRecording(scope, input)
            .pipe(
              Effect.map((value) => ({ service: 'browser', operation: 'stopRecording', value })),
            ),
        )
        .exhaustive()
      return response.pipe(
        Effect.flatMap((value) =>
          Effect.try({
            try: () => decodeDesktopBrowserResult(value),
            catch: () => new Error('Desktop browser service returned an invalid result.'),
          }),
        ),
      )
    }),
  )
}
