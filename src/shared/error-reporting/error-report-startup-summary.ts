/**
 * The grammar of a startup failure summary (src/main/startup-failure-summary.ts, issue #446): an
 * `application` report whose whole message is built from fixed facts, such as
 * `session-host: Error <- WindowsUserOnlySecurityError stage=compile exit=1`. Part of the shared
 * error-report rules (./error-report-rules.ts re-exports it). Only the app's scrubber uses it, to
 * keep the summary's origin; the statistics endpoint keeps the text of any handled `application`
 * report, as it always has, and does not check this grammar. Like the other rules this module
 * imports nothing.
 *
 * A summary can carry `code=ECONNREFUSED` or `exit=503`, which OpenWaggle's error classification
 * would otherwise read as a failed provider request and reduce to a code. A message that matches
 * this grammar in full holds no user content, so it keeps its `application` origin and its text.
 */

/** Where a startup failure summary comes from, the prefix of its message. */
export const STARTUP_FAILURE_SUMMARY_CONTEXTS = [
  /** The GUI's window is open and shows the startup error screen. */
  'gui-session-host-start',
  /** The GUI failed before its window could show anything and exits. */
  'gui-bootstrap',
  /** The detached Session Host stopped on an unrecoverable error. */
  'session-host',
] as const

export type StartupFailureSummaryContext = (typeof STARTUP_FAILURE_SUMMARY_CONTEXTS)[number]

/** The message of a summary whose failure was not an error at all. */
export const STARTUP_FAILURE_SUMMARY_NON_ERROR = 'non-error value'

const TYPE = '[A-Z][A-Za-z0-9]{0,63}'
const INTEGER = '-?\\d{1,10}'
const FACT = [
  'code=(?:E[A-Z0-9]{2,31}|ERR_[A-Z0-9_]{2,60})',
  'stage=[a-z][a-z0-9-]{0,39}',
  `exit=${INTEGER}`,
  'signal=SIG[A-Z0-9]{1,10}',
  `win32=${INTEGER}`,
].join('|')
const ERROR = `${TYPE}(?: (?:${FACT}))*`
const STARTUP_FAILURE_SUMMARY_MESSAGE = new RegExp(
  `^(?:${STARTUP_FAILURE_SUMMARY_CONTEXTS.join('|')}): (?:${STARTUP_FAILURE_SUMMARY_NON_ERROR}|${ERROR}(?: <- ${ERROR}){0,3})$`,
  'u',
)

/** Whether `message` is a startup failure summary in full, and so holds no user content. */
export function isStartupFailureSummaryMessage(message: unknown) {
  return typeof message === 'string' && STARTUP_FAILURE_SUMMARY_MESSAGE.test(message)
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

/**
 * Whether every message of a report is a startup failure summary in full, so none of them quotes
 * user content. A report without exceptions is not one.
 */
export function isStartupFailureSummaryReport(event: unknown) {
  if (!isObject(event)) return false
  const exception: unknown = Reflect.get(event, 'exception')
  const values: unknown = isObject(exception) ? Reflect.get(exception, 'values') : undefined
  if (!Array.isArray(values) || values.length === 0) return false
  const message: unknown = Reflect.get(event, 'message')
  return (
    values.every(
      (value) => isObject(value) && isStartupFailureSummaryMessage(Reflect.get(value, 'value')),
    ) &&
    (message === undefined || isStartupFailureSummaryMessage(message))
  )
}
