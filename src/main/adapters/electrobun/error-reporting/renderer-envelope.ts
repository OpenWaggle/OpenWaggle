import { parseEnvelope } from '@sentry/core'
import type { Event } from '@sentry/bun'

/**
 * The error events of an envelope a renderer's SDK serialized (`@sentry/browser` over the IPC
 * channel `error-reporting:renderer-envelope`). Everything else a renderer could put in an
 * envelope (sessions, attachments, client reports, transactions) is dropped here, and an
 * oversized envelope is dropped whole: only error events are ever reported. Release and
 * environment are the main process's: the browser SDK always names an environment, `production`
 * by default, so the renderer's are dropped for the main SDK to apply its own.
 */
const MAX_RENDERER_ENVELOPE_BYTES = 256 * 1024

function isEvent(value: unknown): value is Event {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function rendererEnvelopeEvents(envelope: string): readonly Event[] {
  if (envelope.length > MAX_RENDERER_ENVELOPE_BYTES) return []
  const [, items] = parseEnvelope(envelope)
  const events: Event[] = []
  for (const [header, payload] of items) {
    if (header.type !== 'event' || !isEvent(payload)) continue
    // A renderer never sets the event type; `undefined` is an error event.
    if (payload.type !== undefined) continue
    delete payload.release
    delete payload.environment
    events.push(payload)
  }
  return events
}
