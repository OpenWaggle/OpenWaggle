import { ERROR_REPORT_ORIGIN_TAG } from '../../src/shared/error-reporting/error-report-constants'
import type { StatisticsDependencies } from './dependencies'
import { configuredValue, type StatisticsEnvironment } from './environment'
import { discardBody } from './http'
import { parseSentryDsn } from './sentry-dsn'
import { serializeSentryEnvelope } from './sentry-envelope'
import { forwardSentryEnvelope } from './sentry-forward'
import { forwardedEnvelopeHeader, scrubSentryEvent } from './sentry-scrub'
import { MS_PER_SECOND } from './time'

/**
 * An error whose message is written by the endpoint and holds no request data, so it may be
 * reported. Other errors are reported by type and stack only: their messages can quote input.
 */
export class EndpointError extends Error {
  override readonly name = 'EndpointError'
}

const STACK_FRAME = /^\s*at (?:(?<fn>.+?) \()?(?<file>.+?):(?<line>\d+):(?<column>\d+)\)?$/u
const MAX_STACK_FRAMES = 50
const LOGGER = 'openwaggle-statistics-endpoint'

interface StackFrame {
  readonly function: string
  readonly filename: string
  readonly lineno: number
  readonly colno: number
  readonly in_app: true
}

/**
 * The endpoint is OpenWaggle's own code, which the shared error-report rules recognize by the
 * `app:///` prefix the app's SDK gives its own files; only the file name is kept. Without it the
 * rules would treat these frames, and the type of the error they threw, as code outside the app.
 */
function endpointCodeLocation(file: string) {
  return `app:///${file.slice(Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')) + 1)}`
}

/** Parses V8 stack lines into Sentry frames, oldest call first as Sentry expects. */
export function stackFrames(stack: string | undefined): StackFrame[] {
  const frames: StackFrame[] = []
  for (const line of (stack ?? '').split('\n')) {
    const groups = STACK_FRAME.exec(line)?.groups
    if (groups?.file === undefined || groups.line === undefined || groups.column === undefined) {
      continue
    }
    frames.push({
      function: groups.fn ?? '<anonymous>',
      filename: endpointCodeLocation(groups.file),
      lineno: Number(groups.line),
      colno: Number(groups.column),
      in_app: true,
    })
  }
  return frames.slice(0, MAX_STACK_FRAMES).reverse()
}

function exceptionValue(error: unknown) {
  if (!(error instanceof Error)) return { type: 'NonError' }
  const frames = stackFrames(error.stack)
  return {
    type: error.name,
    ...(error instanceof EndpointError ? { value: error.message } : {}),
    ...(frames.length > 0 ? { stacktrace: { frames } } : {}),
    // The handler catches it and answers 500, so it is handled; the scrubbing keeps the value
    // of a handled application error, and only an EndpointError has one.
    mechanism: { type: 'generic', handled: true },
  }
}

/**
 * The Sentry event of an exception inside the endpoint; `route` becomes a tag, and the origin
 * tag marks it as the endpoint's own application error.
 */
export function endpointExceptionEvent(
  error: unknown,
  route: string,
  eventId: string,
  now: number,
) {
  return {
    event_id: eventId,
    timestamp: now / MS_PER_SECOND,
    platform: 'javascript',
    level: 'error',
    logger: LOGGER,
    tags: { route, [ERROR_REPORT_ORIGIN_TAG]: 'application' },
    exception: { values: [exceptionValue(error)] },
  }
}

/**
 * Reports an endpoint exception to Sentry through the same scrubbing and forwarding as the
 * app's reports. Does nothing without `SENTRY_DSN`; never throws, since it runs after the
 * response.
 */
export async function reportEndpointException(
  error: unknown,
  route: string,
  environment: StatisticsEnvironment,
  dependencies: StatisticsDependencies,
) {
  const dsn = configuredValue(environment.SENTRY_DSN)
  const project = dsn === undefined ? undefined : parseSentryDsn(dsn)
  if (project === undefined) return
  const now = dependencies.now()
  const eventId = dependencies.randomId()
  const event = scrubSentryEvent(endpointExceptionEvent(error, route, eventId, now))
  const header = forwardedEnvelopeHeader(
    { event_id: eventId, sent_at: new Date(now).toISOString() },
    project.dsn,
  )
  if (event === undefined || header === undefined) return
  const envelope = serializeSentryEnvelope(header, [{ type: 'event', payload: event }])
  const response = await forwardSentryEnvelope(project, envelope, dependencies.fetch)
  if (response !== undefined) await discardBody(response)
  if (response?.ok !== true) {
    dependencies.log(JSON.stringify({ event: 'endpoint.exception_report_failed', route }))
  }
}
