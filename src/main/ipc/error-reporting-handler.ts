import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { reportRendererEnvelope } from '../error-reporting'
import { createLogger } from '../logger'
import { typedOn } from './typed-ipc'

const logger = createLogger('error-reporting-handler')
const decodeEnvelope = Schema.decodeUnknown(Schema.String)

/**
 * Renderer error reports on Electrobun (ADR 0045, 0064): each envelope the renderer's browser SDK
 * serialized goes to the main process's reporter, which keeps only its error events.
 */
export function registerErrorReportingHandlers() {
  typedOn('error-reporting:renderer-envelope', (_event, rawEnvelope: unknown) =>
    decodeEnvelope(rawEnvelope).pipe(
      Effect.map(reportRendererEnvelope),
      Effect.catchAll(() =>
        Effect.sync(() => logger.warn('Dropped a renderer error report that was not an envelope')),
      ),
    ),
  )
}
