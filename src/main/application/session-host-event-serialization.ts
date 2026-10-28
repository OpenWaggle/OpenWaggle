import type { SessionHostEventEnvelope } from '@shared/types/session-host-event'

/**
 * The JSON of each published event's payload, kept while the payload is alive.
 *
 * The hub serializes every event to know its size, and the Local Session server serialized it
 * again to frame it for each subscriber (D8). The payload is the bulk of an event and the same
 * object for every subscriber (only the cursor is projected per caller), so its JSON is reused.
 */
const payloadJson = new WeakMap<object, string>()

/** `{"a":1}` + `"b"`, `2` → `{"a":1,"b":2}`; `head` is a non-empty serialized object. */
export function appendJsonProperty(head: string, key: string, valueJson: string) {
  return `${head.slice(0, -1)},${JSON.stringify(key)}:${valueJson}}`
}

/** `JSON.stringify(event)`, remembering its payload's JSON for the frames that carry it. */
export function serializeSessionHostEvent(event: SessionHostEventEnvelope): string {
  const { payload, ...head } = event
  const json = JSON.stringify(payload)
  payloadJson.set(payload, json)
  return appendJsonProperty(JSON.stringify(head), 'payload', json)
}

/** The event's JSON, reusing its payload's when the hub serialized it. */
export function sessionHostEventJson(event: SessionHostEventEnvelope): string {
  const { payload, ...head } = event
  return appendJsonProperty(
    JSON.stringify(head),
    'payload',
    payloadJson.get(payload) ?? JSON.stringify(payload),
  )
}
