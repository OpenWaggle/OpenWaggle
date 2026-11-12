/**
 * The last check before an error report leaves the main process: the envelope keeps only error
 * events (ADR 0045). Sessions, client reports, attachments, transactions, spans, profiles, replays,
 * logs and metrics never leave, whatever produced them.
 */
import { isRecord } from '../utils/validation'
import { ERROR_REPORT_ENVELOPE_ITEM_TYPE } from './error-report-constants'

/** The dynamic sampling context header carries the per-run trace identifier. */
const TRACE_HEADER = 'trace'

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

function isErrorEventItem(item: unknown, keepEvent: (event: unknown) => boolean) {
  if (!isUnknownArray(item)) return false
  const itemHeaders = item[0]
  return (
    isRecord(itemHeaders) &&
    itemHeaders.type === ERROR_REPORT_ENVELOPE_ITEM_TYPE &&
    keepEvent(item[1])
  )
}

/**
 * Removes every item but error events from a Sentry envelope, in place, together with its trace
 * header, and every error event `keepEvent` rejects. Returns whether an error event is left to
 * send.
 */
export function retainErrorEventsOnly(
  envelope: unknown,
  keepEvent: (event: unknown) => boolean = () => true,
): boolean {
  if (!isUnknownArray(envelope)) return false
  const [headers, items] = envelope
  if (isRecord(headers)) delete headers[TRACE_HEADER]
  if (!isUnknownArray(items)) return false
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (!isErrorEventItem(items[index], keepEvent)) items.splice(index, 1)
  }
  return items.length > 0
}
