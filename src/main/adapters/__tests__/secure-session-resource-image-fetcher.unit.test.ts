import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import { MAX_REMOTE_IMAGE_BYTES } from '../../domain/session-resource-image'
import type { SecureMcpFetch } from '../mcp/runtime/secure-fetch'
import { createSecureSessionResourceImageFetcher } from '../secure-session-resource-image-fetcher'

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

function fakeSecureFetch(response: Response): SecureMcpFetch {
  return Object.assign(
    vi.fn(async () => response),
    { close: vi.fn(async () => undefined) },
  )
}

describe('secure session resource image fetcher', () => {
  it('rejects loopback and private targets before issuing a request', async () => {
    const fetcher = createSecureSessionResourceImageFetcher()

    await expect(
      Effect.runPromise(Effect.flip(fetcher.fetch('https://127.0.0.1/image.png'))),
    ).resolves.toMatchObject({ _tag: 'SessionResourceImageFetchError' })
  })

  it('rejects bodies whose declared size exceeds the image limit', async () => {
    const request = fakeSecureFetch(
      new Response(PNG_BYTES, {
        headers: {
          'content-type': 'image/png',
          'content-length': String(MAX_REMOTE_IMAGE_BYTES + 1),
        },
      }),
    )
    const fetcher = createSecureSessionResourceImageFetcher({ createFetch: () => request })

    await expect(
      Effect.runPromise(Effect.flip(fetcher.fetch('https://images.example.test/large.png'))),
    ).resolves.toMatchObject({ _tag: 'SessionResourceImageFetchError' })
  })

  it('rejects invalid MIME and magic-byte combinations', async () => {
    const request = fakeSecureFetch(
      new Response('<html>not an image</html>', { headers: { 'content-type': 'image/png' } }),
    )
    const fetcher = createSecureSessionResourceImageFetcher({ createFetch: () => request })

    await expect(
      Effect.runPromise(Effect.flip(fetcher.fetch('https://images.example.test/not-image.png'))),
    ).resolves.toMatchObject({ _tag: 'SessionResourceImageFetchError' })
  })

  it('returns validated image bytes and a stable file name', async () => {
    const request = fakeSecureFetch(
      new Response(PNG_BYTES, { headers: { 'content-type': 'image/png' } }),
    )
    const fetcher = createSecureSessionResourceImageFetcher({ createFetch: () => request })

    const result = await Effect.runPromise(
      fetcher.fetch('https://images.example.test/reference.png?version=2'),
    )
    expect(result).toMatchObject({ mimeType: 'image/png', fileName: 'reference.png' })
    expect(result.bytes).toEqual(PNG_BYTES)
    expect(request.close).toHaveBeenCalledOnce()
  })
})
