import path from 'node:path'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { MAX_REMOTE_IMAGE_BYTES, validatedImageBuffer } from '../domain/session-resource-image'
import { SessionResourceImageFetchError } from '../errors'
import {
  SessionResourceImageFetcher,
  type SessionResourceImageFetcherShape,
} from '../ports/session-resource-image-fetcher'
import { createSecureMcpFetch, type SecureMcpFetch } from './mcp/runtime/secure-fetch'

const FETCH_TIMEOUT_MS = 15_000

async function readBoundedBody(response: Response) {
  const declaredLength = Number(response.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REMOTE_IMAGE_BYTES) {
    throw new Error('Remote image exceeds the maximum size.')
  }
  if (!response.body) throw new Error('Remote image response has no body.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const result = await reader.read()
    if (result.done) break
    size += result.value.byteLength
    if (size > MAX_REMOTE_IMAGE_BYTES) {
      await reader.cancel()
      throw new Error('Remote image exceeds the maximum size.')
    }
    chunks.push(result.value)
  }
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    size,
  )
}

function remoteFileName(url: URL, mimeType: string) {
  const fromPath = path.posix.basename(url.pathname)
  if (fromPath && fromPath !== '/') return fromPath
  if (mimeType === 'image/jpeg') return 'remote-image.jpg'
  if (mimeType === 'image/webp') return 'remote-image.webp'
  if (mimeType === 'image/gif') return 'remote-image.gif'
  if (mimeType === 'image/svg+xml') return 'remote-image.svg'
  return 'remote-image.png'
}

function fetchRemoteImage(rawUrl: string, createFetch?: (url: URL) => SecureMcpFetch) {
  return Effect.tryPromise({
    try: async () => {
      const url = new URL(rawUrl)
      if (url.protocol !== 'https:' || url.username || url.password) {
        throw new Error('Remote images must use HTTPS without embedded credentials.')
      }
      const secureFetch = (
        createFetch ?? ((target) => createSecureMcpFetch({ baseUrl: target, allowLoopback: false }))
      )(url)
      try {
        const response = await secureFetch(url, {
          headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml' },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })
        if (!response.ok) throw new Error(`Remote image returned HTTP ${String(response.status)}.`)
        const bytes = await readBoundedBody(response)
        const validated = validatedImageBuffer(bytes, response.headers.get('content-type') ?? '')
        if (!validated) throw new Error('Remote response is not a supported image.')
        return {
          bytes: validated.bytes,
          mimeType: validated.mimeType,
          fileName: remoteFileName(url, validated.mimeType),
        }
      } finally {
        await secureFetch.close()
      }
    },
    catch: (cause) => new SessionResourceImageFetchError({ url: rawUrl, cause }),
  })
}

export function createSecureSessionResourceImageFetcher(
  input: { readonly createFetch?: (url: URL) => SecureMcpFetch } = {},
): SessionResourceImageFetcherShape {
  return {
    fetch: (url) => fetchRemoteImage(url, input.createFetch),
  }
}

export const SecureSessionResourceImageFetcherLive = Layer.succeed(
  SessionResourceImageFetcher,
  SessionResourceImageFetcher.of(createSecureSessionResourceImageFetcher()),
)
