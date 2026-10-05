/**
 * Fixed values for OpenWaggle error reports (ADR 0045).
 *
 * Reports go only to the OpenWaggle endpoint through the Sentry SDK's `tunnel` option. The app
 * holds no Sentry key: the DSN below is a placeholder that the endpoint replaces with the real
 * one before forwarding, so the Sentry project can change without an app release.
 *
 * Dependency-free and alias-free, like ../usage-statistics/contract.ts, so the statistics
 * endpoint can bundle it.
 */
import {
  USAGE_STATISTICS_ERROR_TUNNEL_PATH,
  USAGE_STATISTICS_ORIGIN,
} from '../usage-statistics/contract'

/** Placeholder DSN; the endpoint swaps in the real Sentry DSN server-side. */
export const ERROR_REPORTING_PLACEHOLDER_DSN = 'https://openwaggle@openwaggle.ai/1'

/** Every error report is posted here and nowhere else. */
export const ERROR_REPORTING_TUNNEL_URL = `${USAGE_STATISTICS_ORIGIN}${USAGE_STATISTICS_ERROR_TUNNEL_PATH}`

/** Sentry release name for an app version. */
export function errorReportingRelease(appVersion: string) {
  return `openwaggle@${appVersion}`
}

/**
 * Command-line switch the main process adds to the main window's renderer when it may report
 * errors, even while the Setting is off. Only then does the preload expose the error-report
 * bridge, and the renderer starts its SDK once Usage statistics are on, so Dev builds,
 * automation and the environment opt-outs never initialize error reporting in any process.
 */
export const ERROR_REPORTING_RENDERER_SWITCH = '--openwaggle-error-reporting'

/** Tag naming where a reported error came from. */
export const ERROR_REPORT_ORIGIN_TAG = 'openwaggle.error_origin'

/**
 * Where an error the app reports came from. Only `application` keeps its message text, and only
 * a call site whose messages are known to hold no user content may pass it; an error reported
 * without an origin keeps only its type and code.
 */
export const ERROR_REPORT_ORIGINS = ['application', 'tool-execution', 'provider-response'] as const

export type ErrorReportOrigin = (typeof ERROR_REPORT_ORIGINS)[number]

/** The origin tag scrubbing leaves on a report: a reported origin, or `unhandled`. */
export type ErrorReportTaggedOrigin = ErrorReportOrigin | 'unhandled'

export function isErrorReportOrigin(value: unknown): value is ErrorReportOrigin {
  return typeof value === 'string' && ERROR_REPORT_ORIGINS.some((origin) => origin === value)
}

/** The only envelope item type the app ever sends: error events. */
export const ERROR_REPORT_ENVELOPE_ITEM_TYPE = 'event'

/** Upper bound on how long a process waits for pending reports before it exits. */
export const ERROR_REPORT_FLUSH_TIMEOUT_MS = 2_000

/**
 * The Sentry SDK's `dataCollection` setting, which replaces `sendDefaultPii`: nothing beyond the
 * error itself. No user details or IP inference, cookies, headers, query strings, bodies, AI
 * inputs or outputs, database data, local variables or source lines.
 */
export function errorReportingDataCollection() {
  return {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    stackFrameVariables: false,
    frameContextLines: 0,
  }
}
