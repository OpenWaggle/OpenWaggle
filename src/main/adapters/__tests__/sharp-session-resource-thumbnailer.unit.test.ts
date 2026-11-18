import * as Effect from 'effect/Effect'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  createSharpSessionResourceThumbnailer,
  SESSION_RESOURCE_THUMBNAIL_LIMITS,
} from '../sharp-session-resource-thumbnailer'

describe('createSharpSessionResourceThumbnailer', () => {
  it('renders a bounded WebP preview without enlarging the source', async () => {
    const source = await sharp({
      create: {
        width: 1_200,
        height: 800,
        channels: 4,
        background: { r: 37, g: 99, b: 235, alpha: 1 },
      },
    })
      .png()
      .toBuffer()
    const thumbnailer = createSharpSessionResourceThumbnailer()

    const thumbnail = await Effect.runPromise(thumbnailer.create(source, 'image/png'))
    const metadata = await sharp(thumbnail.bytes).metadata()

    expect(thumbnail.mimeType).toBe('image/webp')
    expect(thumbnail.bytes.byteLength).toBeLessThanOrEqual(
      SESSION_RESOURCE_THUMBNAIL_LIMITS.maxBytes,
    )
    expect(metadata.width).toBeLessThanOrEqual(SESSION_RESOURCE_THUMBNAIL_LIMITS.maxDimensionPixels)
    expect(metadata.height).toBeLessThanOrEqual(
      SESSION_RESOURCE_THUMBNAIL_LIMITS.maxDimensionPixels,
    )
  })

  it('rejects non-image content', async () => {
    const thumbnailer = createSharpSessionResourceThumbnailer()

    const result = await Effect.runPromise(
      thumbnailer.create(Buffer.from('not an image'), 'text/plain').pipe(Effect.either),
    )

    expect(result).toMatchObject({
      _tag: 'Left',
      left: { _tag: 'SessionResourceThumbnailError' },
    })
  })
})
