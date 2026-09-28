import { isRecord } from './validation'

/**
 * Removes binary payloads from MCP results before they become model-visible or draft text.
 *
 * MCP servers return screenshots, audio, and embedded resource blobs as base64 strings. Base64
 * tokenizes at roughly 1.6 characters per token, so a single screenshot serialized as text can
 * cost hundreds of thousands of tokens and overflow the context window in one tool step. Every
 * payload is replaced by a short marker; supported images are handed to `onImage` so the caller
 * can forward them as native image content instead.
 */
export interface McpBinaryImage {
  readonly data: string
  readonly mimeType: string
}

export interface McpBinaryPayloadOptions {
  /**
   * Receives each distinct supported image in encounter order. Return the 1-based image number
   * it was attached as, or `null` when it was not attached (for example, a caller limit).
   */
  readonly onImage?: (image: McpBinaryImage) => number | null
}

const BASE64_PAYLOAD_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/
const BASE64_WHITESPACE_PATTERN = /\s+/g
const DATA_URI_PATTERN = /data:([a-z]+\/[a-z0-9.+-]+)(?:;[a-z0-9=.-]+)*;base64,[A-Za-z0-9+/=\s]+/gi
/** A string this long made only of base64 characters is binary data, not prose or an identifier. */
const MIN_OPAQUE_BASE64_CHARACTERS = 4_096

/** Mirrors Pi's `normalizeSupportedImageMimeType`; providers reject any other inline format. */
export function normalizeMcpImageMimeType(mimeType: string) {
  const base = mimeType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (base === 'image/png' || base === 'image/gif' || base === 'image/webp') return base
  if (base === 'image/jpeg' || base === 'image/jpg') return 'image/jpeg'
  return null
}

function omittedMarker(kind: string, characters: number) {
  return `[${kind} data omitted: ${String(characters)} base64 characters]`
}

function isOpaqueBase64(value: string) {
  return value.length >= MIN_OPAQUE_BASE64_CHARACTERS && BASE64_PAYLOAD_PATTERN.test(value)
}

function replaceStringPayloads(value: string) {
  if (isOpaqueBase64(value)) return omittedMarker('base64', value.length)
  if (!value.includes(';base64,')) return value
  return value.replace(
    DATA_URI_PATTERN,
    (dataUri, mimeType: string) =>
      `[${mimeType.toLowerCase()} data URI omitted: ${String(dataUri.length)} characters]`,
  )
}

interface ImageState {
  readonly numbers: Map<string, number | null>
  readonly onImage: McpBinaryPayloadOptions['onImage']
}

function imageMarker(data: string, mimeType: unknown, state: ImageState) {
  const normalizedMimeType =
    typeof mimeType === 'string' ? normalizeMcpImageMimeType(mimeType) : null
  const payload = data.replace(BASE64_WHITESPACE_PATTERN, '')
  if (!normalizedMimeType || payload.length === 0 || !BASE64_PAYLOAD_PATTERN.test(payload)) {
    return omittedMarker('image', data.length)
  }
  if (!state.numbers.has(payload)) {
    state.numbers.set(
      payload,
      state.onImage?.({ data: payload, mimeType: normalizedMimeType }) ?? null,
    )
  }
  const number = state.numbers.get(payload)
  return typeof number === 'number'
    ? `[image #${String(number)}: ${normalizedMimeType}]`
    : omittedMarker('image', data.length)
}

function replacePayloads(value: unknown, state: ImageState): unknown {
  if (typeof value === 'string') return replaceStringPayloads(value)
  if (Array.isArray(value)) return value.map((item) => replacePayloads(item, state))
  if (!isRecord(value)) return value

  if (value.type === 'image' && typeof value.data === 'string') {
    return { ...value, data: imageMarker(value.data, value.mimeType, state) }
  }
  if (value.type === 'audio' && typeof value.data === 'string') {
    return { ...value, data: omittedMarker('audio', value.data.length) }
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) =>
      key === 'blob' && typeof entry === 'string' && typeof value.uri === 'string'
        ? [key, omittedMarker('resource blob', entry.length)]
        : [key, replacePayloads(entry, state)],
    ),
  )
}

export function replaceMcpBinaryPayloads(value: unknown, options: McpBinaryPayloadOptions = {}) {
  return replacePayloads(value, { numbers: new Map(), onImage: options.onImage })
}
