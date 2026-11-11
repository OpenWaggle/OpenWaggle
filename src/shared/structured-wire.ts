/**
 * Structured-clone semantics over JSON, for desktop shell transports whose wire is JSON
 * (Electrobun's typed RPC, ADR 0064). Electron's IPC structured-clones every argument and result,
 * so the typed channel contract of `@shared/types/ipc` carries `Uint8Array` payloads, `undefined`
 * entries, `Date`s, `Map`s and the like. `encodeStructured` turns such a value into plain JSON with
 * tagged objects for what JSON cannot hold, and `decodeStructured` restores it on the other side.
 *
 * As with structured clone, functions and symbols cannot travel (`DataCloneError`), and class
 * instances arrive as plain objects. Unlike it, a cycle is refused instead of preserved; no IPC
 * payload has one.
 */

const TAG = '$ow'

type BytesKind =
  | 'ArrayBuffer'
  | 'DataView'
  | 'Int8Array'
  | 'Uint8Array'
  | 'Uint8ClampedArray'
  | 'Int16Array'
  | 'Uint16Array'
  | 'Int32Array'
  | 'Uint32Array'
  | 'Float32Array'
  | 'Float64Array'
  | 'BigInt64Array'
  | 'BigUint64Array'

interface ViewCodec {
  readonly kind: BytesKind
  readonly matches: (value: ArrayBufferView) => boolean
  readonly create: (buffer: ArrayBuffer) => ArrayBufferView
}

/** Every `ArrayBufferView` structured clone keeps, most specific first. */
const VIEW_CODECS: readonly ViewCodec[] = [
  {
    kind: 'Uint8ClampedArray',
    matches: (v) => v instanceof Uint8ClampedArray,
    create: (b) => new Uint8ClampedArray(b),
  },
  { kind: 'Uint8Array', matches: (v) => v instanceof Uint8Array, create: (b) => new Uint8Array(b) },
  { kind: 'Int8Array', matches: (v) => v instanceof Int8Array, create: (b) => new Int8Array(b) },
  { kind: 'Int16Array', matches: (v) => v instanceof Int16Array, create: (b) => new Int16Array(b) },
  {
    kind: 'Uint16Array',
    matches: (v) => v instanceof Uint16Array,
    create: (b) => new Uint16Array(b),
  },
  { kind: 'Int32Array', matches: (v) => v instanceof Int32Array, create: (b) => new Int32Array(b) },
  {
    kind: 'Uint32Array',
    matches: (v) => v instanceof Uint32Array,
    create: (b) => new Uint32Array(b),
  },
  {
    kind: 'Float32Array',
    matches: (v) => v instanceof Float32Array,
    create: (b) => new Float32Array(b),
  },
  {
    kind: 'Float64Array',
    matches: (v) => v instanceof Float64Array,
    create: (b) => new Float64Array(b),
  },
  {
    kind: 'BigInt64Array',
    matches: (v) => v instanceof BigInt64Array,
    create: (b) => new BigInt64Array(b),
  },
  {
    kind: 'BigUint64Array',
    matches: (v) => v instanceof BigUint64Array,
    create: (b) => new BigUint64Array(b),
  },
  { kind: 'DataView', matches: (v) => v instanceof DataView, create: (b) => new DataView(b) },
]

const BASE64_CHUNK = 0x8000

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK))
  }
  return btoa(binary)
}

function base64ToBuffer(encoded: string) {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

function encodeNumber(value: number) {
  if (Number.isNaN(value)) return { [TAG]: 'number', value: 'NaN' }
  if (value === Infinity) return { [TAG]: 'number', value: 'Infinity' }
  if (value === -Infinity) return { [TAG]: 'number', value: '-Infinity' }
  if (Object.is(value, -0)) return { [TAG]: 'number', value: '-0' }
  return value
}

function encodeBytes(value: ArrayBuffer | ArrayBufferView) {
  if (value instanceof ArrayBuffer) {
    return { [TAG]: 'bytes', kind: 'ArrayBuffer', base64: bytesToBase64(new Uint8Array(value)) }
  }
  const codec = VIEW_CODECS.find((candidate) => candidate.matches(value))
  if (!codec) throw new TypeError('This kind of binary view cannot be sent.')
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  return { [TAG]: 'bytes', kind: codec.kind, base64: bytesToBase64(bytes) }
}

function encodeWith(value: unknown, ancestors: Set<object>): unknown {
  if (value === undefined) return { [TAG]: 'undefined' }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') return encodeNumber(value)
  if (typeof value === 'bigint') return { [TAG]: 'bigint', value: value.toString() }
  if (typeof value === 'function' || typeof value === 'symbol') {
    throw new TypeError(`A ${typeof value} cannot be sent.`)
  }
  if (ancestors.has(value)) throw new TypeError('A value that contains itself cannot be sent.')
  ancestors.add(value)
  try {
    return encodeObject(value, ancestors)
  } finally {
    ancestors.delete(value)
  }
}

function encodeObject(value: object, ancestors: Set<object>): unknown {
  const encode = (entry: unknown) => encodeWith(entry, ancestors)
  if (Array.isArray(value)) return value.map(encode)
  if (value instanceof Date) return { [TAG]: 'date', value: value.getTime() }
  if (value instanceof RegExp) return { [TAG]: 'regexp', source: value.source, flags: value.flags }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return encodeBytes(value)
  if (value instanceof Map) {
    return { [TAG]: 'map', entries: [...value].map(([key, entry]) => [encode(key), encode(entry)]) }
  }
  if (value instanceof Set) return { [TAG]: 'set', values: [...value].map(encode) }
  if (value instanceof Error) {
    return {
      [TAG]: 'error',
      name: value.name,
      message: value.message,
      ...(value.stack === undefined ? {} : { stack: value.stack }),
    }
  }
  const entries = Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, encode(entry)]),
  )
  // A plain object that has the tag key itself is wrapped, so it never reads as a tagged value.
  return Object.hasOwn(value, TAG) ? { [TAG]: 'object', entries } : entries
}

/** A JSON-safe form of `value` that `decodeStructured` turns back into an equal value. */
export function encodeStructured(value: unknown): unknown {
  return encodeWith(value, new Set())
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(record: Readonly<Record<string, unknown>>, key: string) {
  const field = record[key]
  if (typeof field !== 'string') throw new TypeError(`A sent value has no "${key}" text.`)
  return field
}

function decodeNumber(text: string) {
  if (text === 'NaN') return Number.NaN
  if (text === 'Infinity') return Infinity
  if (text === '-Infinity') return -Infinity
  if (text === '-0') return -0
  throw new TypeError(`"${text}" is not a sent number.`)
}

function decodeBytes(record: Readonly<Record<string, unknown>>): ArrayBuffer | ArrayBufferView {
  const kind = stringField(record, 'kind')
  const buffer = base64ToBuffer(stringField(record, 'base64'))
  if (kind === 'ArrayBuffer') return buffer
  const codec = VIEW_CODECS.find((candidate) => candidate.kind === kind)
  if (!codec) throw new TypeError(`"${kind}" is not a sent binary view.`)
  return codec.create(buffer)
}

function decodeError(record: Readonly<Record<string, unknown>>) {
  const error = new Error(stringField(record, 'message'))
  error.name = stringField(record, 'name')
  const stack = record['stack']
  if (typeof stack === 'string') error.stack = stack
  return error
}

const PAIR_LENGTH = 2

function isPair(value: unknown): value is readonly [unknown, unknown] {
  return Array.isArray(value) && value.length === PAIR_LENGTH
}

function decodeEntries(entries: unknown) {
  if (!Array.isArray(entries)) throw new TypeError('A sent map has no entries.')
  return new Map(
    entries.map((entry: unknown) => {
      if (!isPair(entry)) throw new TypeError('A sent map entry is not a pair.')
      const [key, value] = entry
      return [decodeStructured(key), decodeStructured(value)]
    }),
  )
}

type TaggedDecoder = (record: Readonly<Record<string, unknown>>) => unknown

function decodeDate(record: Readonly<Record<string, unknown>>) {
  const time = record['value']
  if (typeof time !== 'number' && time !== null) throw new TypeError('A sent date has no time.')
  return new Date(time ?? Number.NaN)
}

function decodeSet(record: Readonly<Record<string, unknown>>) {
  const values = record['values']
  if (!Array.isArray(values)) throw new TypeError('A sent set has no values.')
  return new Set(values.map((entry: unknown) => decodeStructured(entry)))
}

/** How each tag `encodeStructured` writes is read back. */
const TAGGED_DECODERS: Readonly<Record<string, TaggedDecoder>> = {
  undefined: () => undefined,
  number: (record) => decodeNumber(stringField(record, 'value')),
  bigint: (record) => BigInt(stringField(record, 'value')),
  date: decodeDate,
  regexp: (record) => new RegExp(stringField(record, 'source'), stringField(record, 'flags')),
  bytes: decodeBytes,
  map: (record) => decodeEntries(record['entries']),
  set: decodeSet,
  error: decodeError,
  object: (record) => decodePlainObject(record['entries']),
}

function decodeTagged(record: Readonly<Record<string, unknown>>, tag: string): unknown {
  const decoder = Object.hasOwn(TAGGED_DECODERS, tag) ? TAGGED_DECODERS[tag] : undefined
  if (!decoder) throw new TypeError(`"${tag}" is not a sent value kind.`)
  return decoder(record)
}

function decodePlainObject(value: unknown) {
  if (!isRecord(value)) throw new TypeError('A sent object has no entries.')
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, decodeStructured(entry)]),
  )
}

/** The value `encodeStructured` encoded. Throws a `TypeError` for anything it did not write. */
export function decodeStructured(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry: unknown) => decodeStructured(entry))
  if (!isRecord(value)) return value
  const tag = value[TAG]
  if (typeof tag === 'string') return decodeTagged(value, tag)
  return decodePlainObject(value)
}

/** An RPC transport as Electrobun's typed RPC drives it: packets out, packets in. */
export interface PacketTransport {
  readonly send?: (packet: unknown) => void | PromiseLike<void>
  readonly registerHandler?: (handler: (packet: unknown) => void) => void
  readonly unregisterHandler?: () => void
}

/** The packet fields that carry values: request `params` and response or message `payload`. */
const PACKET_VALUE_FIELDS = ['params', 'payload'] as const

function mapPacketValues(packet: unknown, map: (value: unknown) => unknown) {
  if (!isRecord(packet)) return packet
  const mapped: Record<string, unknown> = { ...packet }
  for (const field of PACKET_VALUE_FIELDS) {
    if (Object.hasOwn(packet, field)) mapped[field] = map(packet[field])
  }
  return mapped
}

/**
 * Wraps a JSON RPC transport so the typed RPC above it sends and receives structured values: it
 * encodes the values of every outgoing packet and decodes those of every incoming one.
 */
export function structuredTransport(inner: PacketTransport): PacketTransport {
  return {
    send: (packet) => inner.send?.(mapPacketValues(packet, encodeStructured)),
    registerHandler: (handler) =>
      inner.registerHandler?.((packet) => handler(mapPacketValues(packet, decodeStructured))),
    unregisterHandler: () => inner.unregisterHandler?.(),
  }
}
