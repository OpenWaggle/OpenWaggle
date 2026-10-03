/**
 * Scrubbing applied to every error report before Sentry receives it (ADR 0045). It applies the
 * rules the app scrubs by (src/shared/error-reporting/error-report-rules.ts): it removes fields
 * that can identify a person, a machine or a session, keeps only an allowlist of contexts,
 * applies the text rules of ./sentry-text.ts to every string and key, reduces stack frames and
 * debug images of code outside the app to `<external>`, keeps a built-in error type for an
 * exception that code threw, and keeps message text only for errors the app reported itself as
 * handled application errors.
 */
import {
  ERROR_REPORT_CONTEXT_ALLOWLIST,
  ERROR_REPORT_DROPPED_EVENT_KEYS,
  ERROR_REPORT_DROPPED_FRAME_KEYS,
  ERROR_REPORT_PATHS_ONLY_EVENT_KEYS,
  ERROR_REPORT_VERBATIM_EVENT_KEYS,
  keepsErrorReportMessageText,
  scrubErrorReportDebugMeta,
  scrubErrorReportExceptionType,
  scrubErrorReportFrameLocation,
} from '../../src/shared/error-reporting/error-report-rules'
import { isRecord } from './http'
import { type JsonRecord, onlyKeys, updateList, updateRecord, withoutKeys } from './json-record'
import { withoutMessageText } from './sentry-message'
import { scrubPaths, scrubReportText } from './sentry-text'

const MAX_SCRUB_DEPTH = 64
const ENVELOPE_HEADER_DROPPED_KEYS: ReadonlySet<string> = new Set(['dsn', 'trace'])
const ENVELOPE_HEADER_VERBATIM_KEYS: ReadonlySet<string> = new Set(['event_id'])

class NestingTooDeep extends Error {}

function scrubValue(value: unknown, depth: number, scrub: (text: string) => string): unknown {
  if (typeof value === 'string') return scrub(value)
  if (typeof value !== 'object' || value === null) return value
  if (depth >= MAX_SCRUB_DEPTH) throw new NestingTooDeep()
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value
    return items.map((item) => scrubValue(item, depth + 1, scrub))
  }
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [scrub(key), scrubValue(item, depth + 1, scrub)]),
  )
}

/**
 * Scrubs every string and key of a JSON object with all text rules, except the top-level
 * `verbatim` fields and the `pathsOnly` fields, which lose only paths. Returns `undefined`
 * when the value nests too deeply to scrub.
 */
export function scrubJsonRecord(
  value: JsonRecord,
  verbatim: ReadonlySet<string> = new Set(),
  pathsOnly: ReadonlySet<string> = new Set(),
): JsonRecord | undefined {
  try {
    const entries = Object.entries(value).map(([key, item]): [string, unknown] => {
      if (verbatim.has(key)) return [key, item]
      const scrub = pathsOnly.has(key) ? scrubPaths : scrubReportText
      return [scrubReportText(key), scrubValue(item, 1, scrub)]
    })
    return Object.fromEntries(entries)
  } catch (error) {
    if (error instanceof NestingTooDeep) return undefined
    throw error
  }
}

/** Keeps the allowlisted contexts and fields, dropping contexts left empty. */
export function allowlistedContexts(contexts: JsonRecord): JsonRecord {
  const kept: [string, JsonRecord][] = []
  for (const [name, fields] of ERROR_REPORT_CONTEXT_ALLOWLIST) {
    const context = contexts[name]
    if (!isRecord(context)) continue
    const allowed = onlyKeys(context, fields)
    if (Object.keys(allowed).length > 0) kept.push([name, allowed])
  }
  return Object.fromEntries(kept)
}

/**
 * A frame without variables or source lines. The shared rule rewrites it in place, so it gets
 * a copy: code outside the app keeps only `<external>` and loses its function and module names.
 */
function scrubbedFrame(frame: JsonRecord): JsonRecord {
  const kept = { ...withoutKeys(frame, ERROR_REPORT_DROPPED_FRAME_KEYS) }
  scrubErrorReportFrameLocation(kept)
  return kept
}

function withoutFrameVariables(holder: JsonRecord) {
  return updateRecord(holder, 'stacktrace', (stacktrace) =>
    updateList(stacktrace, 'frames', scrubbedFrame),
  )
}

/** Debug images of code outside the app keep only their files' basenames, on copies. */
function externalDebugImages(debugMeta: JsonRecord): JsonRecord {
  const copy = updateList(debugMeta, 'images', (image) => ({ ...image }))
  scrubErrorReportDebugMeta(copy)
  return copy
}

/** An exception code outside the app threw keeps only a built-in error type, on a copy. */
function withBuiltInErrorType(exception: JsonRecord): JsonRecord {
  const kept = { ...exception }
  scrubErrorReportExceptionType(kept)
  return kept
}

function withoutValueFrameVariables(container: JsonRecord) {
  return updateList(container, 'values', withoutFrameVariables)
}

/**
 * Scrubs an error event: drops the user, machine name, breadcrumbs, request and module list,
 * keeps only allowlisted contexts, drops stack-frame variables and source lines, applies the
 * text rules, and reduces message text to error codes unless `keepsErrorReportMessageText`. The app
 * scrubs the same way before sending (src/shared/error-reporting); this is the second line.
 */
export function scrubSentryEvent(event: JsonRecord): JsonRecord | undefined {
  const scrubbed = scrubJsonRecord(
    event,
    ERROR_REPORT_VERBATIM_EVENT_KEYS,
    ERROR_REPORT_PATHS_ONLY_EVENT_KEYS,
  )
  if (scrubbed === undefined) return undefined
  const steps: readonly ((value: JsonRecord) => JsonRecord)[] = [
    (value) => withoutKeys(value, ERROR_REPORT_DROPPED_EVENT_KEYS),
    (value) => updateRecord(value, 'contexts', allowlistedContexts),
    (value) =>
      updateRecord(value, 'exception', (exception) =>
        updateList(exception, 'values', withBuiltInErrorType),
      ),
    (value) => updateRecord(value, 'exception', withoutValueFrameVariables),
    (value) => updateRecord(value, 'threads', withoutValueFrameVariables),
    withoutFrameVariables,
    (value) => updateRecord(value, 'debug_meta', externalDebugImages),
    (value) => (keepsErrorReportMessageText(value) ? value : withoutMessageText(value)),
  ]
  return steps.reduce((value, step) => step(value), scrubbed)
}

/**
 * The header of a forwarded envelope: the app's placeholder DSN is replaced by the real one,
 * and the trace context, which can name a user segment, is dropped.
 */
export function forwardedEnvelopeHeader(header: JsonRecord, dsn: string): JsonRecord | undefined {
  const scrubbed = scrubJsonRecord(header, ENVELOPE_HEADER_VERBATIM_KEYS)
  if (scrubbed === undefined) return undefined
  return { ...withoutKeys(scrubbed, ENVELOPE_HEADER_DROPPED_KEYS), dsn }
}
