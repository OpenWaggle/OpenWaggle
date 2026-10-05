/**
 * Scrubbing applied to every error report before it leaves the app (ADR 0045), using the rules
 * the statistics endpoint applies again (./error-report-rules.ts).
 *
 * The main-process and renderer error reporters run this in the Sentry SDK's `beforeSend`, so a
 * report is scrubbed where it is created and again in the main process, which sends every report.
 * It works on the structural subset of a Sentry event it changes and mutates it in place, as
 * `beforeSend` allows, so it carries no vendor dependency.
 *
 * - User, request, server name, breadcrumbs, module lists, source lines and local variables are
 *   dropped, and every context but the allowlisted OS, architecture, app and runtime versions.
 *   A stack frame or debug image outside the app's own code keeps only `<external>`, and an
 *   exception that code threw keeps only a built-in error type.
 * - Only an error the app reported itself as a handled `application` error keeps its message
 *   text. Every other report keeps its error types and a code from OpenWaggle's error
 *   classification: an unhandled error or one from tool execution or a provider response can
 *   quote files, commands or model output.
 * - The text rules then replace home directories, temporary and scratch folders, UUIDs and long
 *   hex runs in every string and key, except the event id and release Sentry needs verbatim.
 */
import { classifyErrorMessage, isAgentErrorCode } from '../domain/error-classifier'
import { isRecord } from '../utils/validation'
import {
  ERROR_REPORT_ORIGIN_TAG,
  type ErrorReportOrigin,
  type ErrorReportTaggedOrigin,
  isErrorReportOrigin,
} from './error-report-constants'
import {
  createErrorReportPathScrubber,
  createErrorReportTextScrubber,
  ERROR_REPORT_CONTEXT_ALLOWLIST,
  ERROR_REPORT_DROPPED_EVENT_KEYS,
  ERROR_REPORT_DROPPED_FRAME_KEYS,
  ERROR_REPORT_PATHS_ONLY_EVENT_KEYS,
  ERROR_REPORT_VERBATIM_EVENT_KEYS,
  type ErrorReportKnownDirectories,
  HTTP_ERROR_CODE_PATTERN,
  hasUnhandledErrorReportException,
  keepsErrorReportMessageText,
  leadingNodeErrorCode,
  NODE_ERROR_CODE_PATTERN,
  scrubErrorReportDebugMeta,
  scrubErrorReportExceptionType,
  scrubErrorReportFrameLocation,
} from './error-report-rules'

export interface ErrorReportStackFrame {
  filename?: string
  abs_path?: string
  module?: string
  function?: string
  vars?: unknown
  context_line?: string
  pre_context?: string[]
  post_context?: string[]
}

interface ErrorReportStackTrace {
  frames?: ErrorReportStackFrame[]
}

export interface ErrorReportException {
  type?: string
  value?: string
  stacktrace?: ErrorReportStackTrace
  mechanism?: { handled?: boolean }
}

/** The part of a Sentry event that scrubbing reads or changes. */
export interface ErrorReportEvent {
  event_id?: string
  message?: string
  logentry?: { message?: string; params?: unknown[] }
  exception?: { values?: ErrorReportException[] }
  threads?: { values?: { stacktrace?: ErrorReportStackTrace }[] }
  stacktrace?: ErrorReportStackTrace
  tags?: { [key: string]: unknown }
  extra?: { [key: string]: unknown }
  contexts?: { [key: string]: { [key: string]: unknown } | undefined }
  user?: unknown
  request?: unknown
  server_name?: string
  breadcrumbs?: unknown[]
  modules?: unknown
  debug_meta?: unknown
}

export interface ErrorReportScrubOptions extends ErrorReportKnownDirectories {
  /** The thrown value the report describes, from the SDK's event hint. */
  readonly originalException?: unknown
  /**
   * Whether to apply the text rules. The renderer passes `false`: it does not know the home
   * directory, and the main process applies every text rule to renderer reports before sending.
   */
  readonly scrubText?: boolean
}

const UNKNOWN_ERROR_CODE = 'unknown'
const HTTP_STATUS_MIN = 100
const HTTP_STATUS_MAX = 599
/**
 * Error classes raised for a failed provider or MCP request: the OpenAI and Anthropic SDKs, Pi's
 * provider adapters, Google's SDK, the MCP SDK, and Bedrock's AWS service exceptions.
 */
const PROVIDER_ERROR_TYPE_PATTERN =
  /(?:API|Api|Http|HTTP|Provider|Models|Response|Protocol|Mcp|RateLimit|Authentication|PermissionDenied|BadRequest|InternalServer|UnprocessableEntity|WebSocketClose|RetryDelayExceeded|GenerativeAI)[A-Za-z]*Error$|(?:AccessDenied|InternalServer|Model[A-Za-z]*|ResourceNotFound|ServiceQuotaExceeded|ServiceUnavailable|Throttling|Validation)Exception$/u
/** Sentry's serialized copy of a thrown non-Error value, which can be any data. */
const SERIALIZED_THROWN_VALUE_KEY = '__serialized__'
/** Top-level event fields the full text rules skip: verbatim, or scrubbed for paths only. */
const NOT_TEXT_RULED: ReadonlySet<string> = new Set([
  ...ERROR_REPORT_VERBATIM_EVENT_KEYS,
  ...ERROR_REPORT_PATHS_ONLY_EVENT_KEYS,
])

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

function scrubArrayStrings(
  values: unknown[],
  scrub: (text: string) => string,
  seen: WeakSet<object>,
) {
  for (let index = 0; index < values.length; index += 1) {
    const item = values[index]
    if (typeof item === 'string') values[index] = scrub(item)
    else scrubStringsInPlace(item, scrub, seen)
  }
}

function scrubRecordStrings(
  record: Record<string, unknown>,
  scrub: (text: string) => string,
  seen: WeakSet<object>,
  verbatimKeys: ReadonlySet<string>,
) {
  for (const key of Object.keys(record)) {
    if (verbatimKeys.has(key)) continue
    const item = record[key]
    if (typeof item === 'string') record[key] = scrub(item)
    else scrubStringsInPlace(item, scrub, seen)
    const scrubbedKey = scrub(key)
    if (scrubbedKey === key) continue
    record[scrubbedKey] = record[key]
    delete record[key]
  }
}

/** Applies `scrub` to every string, object keys included, in a JSON-like value. */
export function scrubStringsInPlace(
  value: unknown,
  scrub: (text: string) => string,
  seen = new WeakSet<object>(),
  verbatimKeys: ReadonlySet<string> = new Set(),
): void {
  if (typeof value !== 'object' || value === null || seen.has(value)) return
  seen.add(value)
  if (isUnknownArray(value)) {
    scrubArrayStrings(value, scrub, seen)
    return
  }
  if (isRecord(value)) scrubRecordStrings(value, scrub, seen, verbatimKeys)
}

function isErrorReportCode(text: string) {
  return (
    isAgentErrorCode(text) ||
    NODE_ERROR_CODE_PATTERN.test(text) ||
    HTTP_ERROR_CODE_PATTERN.test(text)
  )
}

function ownErrorCode(error: unknown) {
  if (typeof error !== 'object' || error === null) return undefined
  const code: unknown = Reflect.get(error, 'code')
  if (typeof code === 'string' && NODE_ERROR_CODE_PATTERN.test(code)) return code
  const status: unknown = Reflect.get(error, 'status') ?? Reflect.get(error, 'statusCode')
  return typeof status === 'number' &&
    Number.isInteger(status) &&
    status >= HTTP_STATUS_MIN &&
    status <= HTTP_STATUS_MAX
    ? `http-${String(status)}`
    : undefined
}

/**
 * The code an error is reported by when its message text is dropped: the message itself when it
 * already is a code, OpenWaggle's error classification of the message, the error's own Node.js
 * error code or HTTP status, the Node.js error code the message starts with, or `unknown`.
 */
export function errorReportCode(message: string | undefined, error?: unknown): string {
  if (message !== undefined && isErrorReportCode(message)) return message
  const classified = message ? classifyErrorMessage(message).code : UNKNOWN_ERROR_CODE
  if (classified !== UNKNOWN_ERROR_CODE) return classified
  return (
    ownErrorCode(error) ??
    (message ? leadingNodeErrorCode(message) : undefined) ??
    UNKNOWN_ERROR_CODE
  )
}

function isClassifiedFailure(message: string | undefined) {
  return (
    message !== undefined &&
    !isErrorReportCode(message) &&
    classifyErrorMessage(message).code !== UNKNOWN_ERROR_CODE
  )
}

function looksLikeProviderFailure(event: ErrorReportEvent) {
  return (
    isClassifiedFailure(event.message) ||
    (event.exception?.values ?? []).some(
      (exception) =>
        isClassifiedFailure(exception.value) ||
        (exception.type !== undefined && PROVIDER_ERROR_TYPE_PATTERN.test(exception.type)),
    )
  )
}

function taggedOrigin(event: ErrorReportEvent): ErrorReportOrigin | undefined {
  const tagged = event.tags?.[ERROR_REPORT_ORIGIN_TAG]
  return isErrorReportOrigin(tagged) ? tagged : undefined
}

/**
 * Where a reported error came from: `unhandled` when nothing handled it, else the tool or
 * provider origin its reporter tagged, else `provider-response` when OpenWaggle's error
 * classification or the error class marks a failed provider request, else the `application`
 * origin its reporter tagged. An error reported without an origin has none.
 */
export function errorReportOrigin(event: ErrorReportEvent): ErrorReportTaggedOrigin | undefined {
  if (hasUnhandledErrorReportException(event)) return 'unhandled'
  const tagged = taggedOrigin(event)
  if (tagged === 'tool-execution' || tagged === 'provider-response') return tagged
  if (looksLikeProviderFailure(event)) return 'provider-response'
  return tagged
}

function dropMessageText(event: ErrorReportEvent, originalException: unknown) {
  const exceptions = event.exception?.values ?? []
  const thrownIndex = exceptions.length - 1
  exceptions.forEach((exception, index) => {
    // Sentry lists linked causes first; the thrown error itself is the last value.
    exception.value = errorReportCode(
      exception.value,
      index === thrownIndex ? originalException : undefined,
    )
  })
  if (event.logentry) {
    event.logentry = { message: errorReportCode(event.logentry.message ?? event.message) }
  }
  if (event.message !== undefined) event.message = errorReportCode(event.message)
  delete event.extra
}

function scrubFrames(stacktrace: ErrorReportStackTrace | undefined) {
  for (const frame of stacktrace?.frames ?? []) {
    scrubErrorReportFrameLocation(frame)
    for (const key of ERROR_REPORT_DROPPED_FRAME_KEYS) Reflect.deleteProperty(frame, key)
  }
}

function scrubCodeLocations(event: ErrorReportEvent) {
  for (const exception of event.exception?.values ?? []) {
    // Before the frames change: the type depends on who threw, the last frame.
    scrubErrorReportExceptionType(exception)
    scrubFrames(exception.stacktrace)
  }
  for (const thread of event.threads?.values ?? []) scrubFrames(thread.stacktrace)
  scrubFrames(event.stacktrace)
  scrubErrorReportDebugMeta(event.debug_meta)
}

function keepAllowlistedContexts(event: ErrorReportEvent) {
  const contexts = event.contexts
  if (!contexts) return
  for (const name of Object.keys(contexts)) {
    const fields = ERROR_REPORT_CONTEXT_ALLOWLIST.get(name)
    const context = contexts[name]
    if (!fields || !context) {
      delete contexts[name]
      continue
    }
    for (const field of Object.keys(context)) if (!fields.has(field)) delete context[field]
    if (Object.keys(context).length === 0) delete contexts[name]
  }
}

function applyOrigin(event: ErrorReportEvent) {
  const origin = errorReportOrigin(event)
  if (origin) {
    event.tags = { ...event.tags, [ERROR_REPORT_ORIGIN_TAG]: origin }
    return
  }
  if (event.tags) delete event.tags[ERROR_REPORT_ORIGIN_TAG]
}

function scrubText(event: ErrorReportEvent, options: ErrorReportScrubOptions) {
  scrubStringsInPlace(event, createErrorReportTextScrubber(options), new WeakSet(), NOT_TEXT_RULED)
  // `debug_meta` keeps its debug ids, which match source maps, and loses only paths.
  const scrubPaths = createErrorReportPathScrubber(options)
  for (const key of ERROR_REPORT_PATHS_ONLY_EVENT_KEYS) {
    scrubStringsInPlace(Reflect.get(event, key), scrubPaths)
  }
}

/**
 * Scrubs `event` in place, for use in Sentry's `beforeSend`. Whether the report may be sent at
 * all is decided separately, by the caller.
 */
export function scrubErrorReportEvent(
  event: ErrorReportEvent,
  options: ErrorReportScrubOptions = {},
): void {
  for (const key of ERROR_REPORT_DROPPED_EVENT_KEYS) Reflect.deleteProperty(event, key)
  if (event.extra) delete event.extra[SERIALIZED_THROWN_VALUE_KEY]
  scrubCodeLocations(event)
  keepAllowlistedContexts(event)
  applyOrigin(event)
  if (!keepsErrorReportMessageText(event)) dropMessageText(event, options.originalException)
  if (options.scrubText !== false) scrubText(event, options)
}
