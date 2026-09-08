import { Buffer } from 'node:buffer'
import { HEX_RADIX } from '@shared/constants/math'
import type { WebContents } from 'electron'
import { browserPreviewImageDimensions } from './browser-preview-favicon-dimensions'
import {
  type BrowserPreviewFaviconCaptureResult,
  rasterizeBrowserPreviewFavicon,
} from './browser-preview-favicon-raster'

export const BROWSER_PREVIEW_FAVICON_LIMITS = {
  CANDIDATES: 8,
  CAPTURE_MS: 5_000,
  HTTP_URL_LENGTH: 2_048,
  INLINE_URL_LENGTH: 133_464,
  INPUT_UNITS: 262_144,
  MIN_CANDIDATE_UNITS: 256,
  RESPONSE_BYTES: 100_000,
} as const

const DATA_URL_PARAMETERS_GROUP = 2
const DATA_URL_PAYLOAD_GROUP = 3
const PERCENT_ESCAPE_WIDTH = 3
const BASE64_GROUP_SIZE = 4

export function safeBrowserPreviewOrigin(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null
  } catch {
    return null
  }
}

function supportedCandidate(candidate: string) {
  if (candidate.length > BROWSER_PREVIEW_FAVICON_LIMITS.INLINE_URL_LENGTH) return false
  if (/^data:/iu.test(candidate)) return /^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/iu.test(candidate)
  try {
    const protocol = new URL(candidate).protocol
    return (
      (protocol === 'http:' || protocol === 'https:') &&
      candidate.length <= BROWSER_PREVIEW_FAVICON_LIMITS.HTTP_URL_LENGTH
    )
  } catch {
    return false
  }
}

export function selectBrowserPreviewFaviconCandidates(
  candidates: readonly string[],
): readonly string[] {
  const selected: string[] = []
  const seen = new Set<string>()
  let inputUnits = 0
  for (const candidate of candidates) {
    inputUnits += Math.max(BROWSER_PREVIEW_FAVICON_LIMITS.MIN_CANDIDATE_UNITS, candidate.length)
    if (inputUnits > BROWSER_PREVIEW_FAVICON_LIMITS.INPUT_UNITS) break
    if (!supportedCandidate(candidate) || seen.has(candidate)) continue
    seen.add(candidate)
    selected.push(candidate)
    if (selected.length === BROWSER_PREVIEW_FAVICON_LIMITS.CANDIDATES) break
  }
  return selected
}

function decodePercentEncoded(payload: string): Buffer | null {
  const output = Buffer.allocUnsafe(Buffer.byteLength(payload))
  let inputOffset = 0
  let outputOffset = 0
  while (inputOffset < payload.length) {
    const escapeOffset = payload.indexOf('%', inputOffset)
    const literalEnd = escapeOffset < 0 ? payload.length : escapeOffset
    outputOffset += output.write(payload.slice(inputOffset, literalEnd), outputOffset, 'utf8')
    if (escapeOffset < 0) break
    const hex = payload.slice(escapeOffset + 1, escapeOffset + PERCENT_ESCAPE_WIDTH)
    if (!/^[0-9a-f]{2}$/iu.test(hex)) return null
    output[outputOffset] = Number.parseInt(hex, HEX_RADIX)
    outputOffset += 1
    inputOffset = escapeOffset + PERCENT_ESCAPE_WIDTH
  }
  return output.subarray(0, outputOffset)
}

function decodeBase64(payload: string) {
  if (!/^[a-z0-9+/]*={0,2}$/iu.test(payload) || payload.length % BASE64_GROUP_SIZE === 1) {
    return null
  }
  const buffer = Buffer.from(payload, 'base64')
  return buffer.toString('base64').replace(/=+$/u, '') === payload.replace(/=+$/u, '')
    ? buffer
    : null
}

function inlineCandidate(candidate: string) {
  if (candidate.length > BROWSER_PREVIEW_FAVICON_LIMITS.INLINE_URL_LENGTH) return null
  const match = /^data:(image\/[a-z0-9.+-]+)((?:;[^,]*)?),(.*)$/isu.exec(candidate)
  if (!match) return null
  const mime = match[1]?.toLowerCase()
  const parameters = match[DATA_URL_PARAMETERS_GROUP]
    ?.split(';')
    .filter(Boolean)
    .map((value) => value.toLowerCase())
  const payload = match[DATA_URL_PAYLOAD_GROUP]
  if (!mime || !parameters || payload === undefined) return null
  const base64 = parameters.at(-1) === 'base64'
  if (parameters.includes('base64') && !base64) return null
  const buffer = base64 ? decodeBase64(payload) : decodePercentEncoded(payload)
  return buffer !== null &&
    buffer.byteLength > 0 &&
    buffer.byteLength <= BROWSER_PREVIEW_FAVICON_LIMITS.RESPONSE_BYTES
    ? { buffer, mime }
    : null
}

async function readResponse(response: Response, signal: AbortSignal): Promise<Buffer | null> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > BROWSER_PREVIEW_FAVICON_LIMITS.RESPONSE_BYTES
  ) {
    await response.body?.cancel()
    return null
  }
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer())
    return buffer.byteLength <= BROWSER_PREVIEW_FAVICON_LIMITS.RESPONSE_BYTES ? buffer : null
  }
  const reader = response.body.getReader()
  const cancel = () => void reader.cancel(signal.reason).catch(() => undefined)
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()
  const chunks: Buffer[] = []
  let byteLength = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) return Buffer.concat(chunks, byteLength)
      byteLength += next.value.byteLength
      if (byteLength > BROWSER_PREVIEW_FAVICON_LIMITS.RESPONSE_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(Buffer.from(next.value))
    }
  } finally {
    signal.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
}

async function loadCandidate(
  contents: WebContents,
  pageOrigin: string,
  candidate: string,
  signal: AbortSignal,
) {
  const inline = inlineCandidate(candidate)
  if (inline) return inline
  const candidateOrigin = safeBrowserPreviewOrigin(candidate)
  if (!candidateOrigin) return null
  const response = await contents.session.fetch(candidate, {
    credentials: candidateOrigin === pageOrigin ? 'include' : 'omit',
    redirect: 'error',
    signal,
  })
  if (!response.ok) {
    await response.body?.cancel()
    return null
  }
  return {
    buffer: await readResponse(response, signal),
    mime: response.headers.get('content-type')?.split(';', 1)[0] ?? null,
  }
}

function normalizedFaviconMime(mime: string | null) {
  const declared = mime?.trim().toLowerCase() ?? ''
  if (declared === 'application/x-icon') return 'image/x-icon'
  if (declared === 'application/octet-stream' || declared === 'binary/octet-stream') return ''
  return declared
}

async function captureCandidate(
  contents: WebContents,
  pageOrigin: string,
  candidate: string,
  signal: AbortSignal,
): Promise<BrowserPreviewFaviconCaptureResult> {
  try {
    const source = await loadCandidate(contents, pageOrigin, candidate, signal)
    const dimensions = source?.buffer ? browserPreviewImageDimensions(source.buffer) : null
    const normalizedMime = normalizedFaviconMime(source?.mime ?? null)
    if (
      !source?.buffer ||
      dimensions === null ||
      normalizedMime === 'image/svg+xml' ||
      (normalizedMime !== '' && !/^image\/[a-z0-9.+-]+$/iu.test(normalizedMime))
    ) {
      return { kind: 'none' }
    }
    return rasterizeBrowserPreviewFavicon(
      contents,
      normalizedMime,
      source.buffer,
      dimensions,
      signal,
    )
  } catch {
    return { kind: 'none' }
  }
}

export async function captureBrowserPreviewFavicon(input: {
  readonly webContents: WebContents
  readonly pageUrl: string
  readonly candidates: readonly string[]
  readonly signal: AbortSignal
}): Promise<BrowserPreviewFaviconCaptureResult> {
  const pageOrigin = safeBrowserPreviewOrigin(input.pageUrl)
  if (!pageOrigin) return { kind: 'none' }
  const timeout = AbortSignal.timeout(BROWSER_PREVIEW_FAVICON_LIMITS.CAPTURE_MS)
  const signal = AbortSignal.any([input.signal, timeout])
  for (const candidate of selectBrowserPreviewFaviconCandidates(input.candidates)) {
    if (signal.aborted) return input.signal.aborted ? { kind: 'none' } : { kind: 'timed-out' }
    const result = await captureCandidate(input.webContents, pageOrigin, candidate, signal)
    if (result.kind !== 'none') return result
  }
  return { kind: 'none' }
}
