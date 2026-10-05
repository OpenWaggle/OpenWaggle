/**
 * Message text of error reports that may not keep it (`keepsErrorReportMessageText` in
 * src/shared/error-reporting/error-report-rules.ts): each exception value and the message become
 * an error code, as the app's own scrubbing does, and `extra` is dropped.
 */
import {
  HTTP_ERROR_CODE_PATTERN,
  leadingNodeErrorCode,
  NODE_ERROR_CODE_PATTERN,
} from '../../src/shared/error-reporting/error-report-rules'
import { isRecord } from './http'
import { type JsonRecord, updateList, updateRecord, withoutKeys } from './json-record'

/**
 * OpenWaggle's error classification codes (`AgentErrorCode` in src/shared/types/errors.ts). The
 * classifier is not dependency-free, so the endpoint keeps its own list; a unit test keeps it
 * equal to the classifier's.
 */
export const AGENT_ERROR_CODES: ReadonlySet<string> = new Set([
  'api-key-invalid',
  'session-expired',
  'insufficient-credits',
  'rate-limited',
  'provider-down',
  'model-not-found',
  'provider-unavailable',
  'session-not-found',
  'no-project',
  'persist-failed',
  'context-overflow',
  'runtime-package-manager-unavailable',
  'unknown',
])

const UNKNOWN_ERROR_CODE = 'unknown'
const DROPPED_WITH_MESSAGES: ReadonlySet<string> = new Set(['extra'])

/**
 * The code a message is reported by: the message itself when it already is a code (the app
 * reports tool and provider errors that way), the Node error code it starts with, such as
 * `ENOENT`, or `unknown`.
 */
export function errorCode(text: unknown) {
  if (typeof text !== 'string') return UNKNOWN_ERROR_CODE
  const isCode =
    NODE_ERROR_CODE_PATTERN.test(text) ||
    HTTP_ERROR_CODE_PATTERN.test(text) ||
    AGENT_ERROR_CODES.has(text)
  if (isCode) return text
  return leadingNodeErrorCode(text) ?? UNKNOWN_ERROR_CODE
}

function withCodeValue(exception: JsonRecord): JsonRecord {
  return 'value' in exception ? { ...exception, value: errorCode(exception.value) } : exception
}

function messageCode(message: unknown) {
  if (!isRecord(message)) return errorCode(message)
  return errorCode(message.formatted ?? message.message)
}

/** The event with only error types and codes left of its message text. */
export function withoutMessageText(event: JsonRecord): JsonRecord {
  const coded = updateRecord(event, 'exception', (exception) =>
    updateList(exception, 'values', withCodeValue),
  )
  const message = 'message' in coded ? { message: messageCode(coded.message) } : {}
  const logentry = isRecord(coded.logentry)
    ? { logentry: { message: messageCode(coded.logentry.message ?? coded.message) } }
    : {}
  return { ...withoutKeys(coded, DROPPED_WITH_MESSAGES), ...message, ...logentry }
}
