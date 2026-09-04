import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import sharp from 'sharp'
import { SessionResourceThumbnailError } from '../errors'
import {
  SessionResourceThumbnailer,
  type SessionResourceThumbnailerShape,
} from '../ports/session-resource-thumbnailer'

export const SESSION_RESOURCE_THUMBNAIL_LIMITS = {
  maxBytes: 512 * 1024,
  maxDimensionPixels: 256,
  maxInputPixels: 40_000_000,
} as const
const THUMBNAIL_WEBP_OPTIONS = { alphaQuality: 72, effort: 4, quality: 72 } as const

function thumbnailError(cause: unknown) {
  return new SessionResourceThumbnailError({ operation: 'create', cause })
}

export function createSharpSessionResourceThumbnailer(): SessionResourceThumbnailerShape {
  return {
    create: (bytes, mimeType) =>
      Effect.tryPromise({
        try: async () => {
          if (!mimeType.toLowerCase().startsWith('image/')) {
            throw new Error('Only image resources can be thumbnailed.')
          }
          const thumbnail = await sharp(bytes, {
            animated: false,
            limitInputPixels: SESSION_RESOURCE_THUMBNAIL_LIMITS.maxInputPixels,
          })
            .rotate()
            .resize({
              width: SESSION_RESOURCE_THUMBNAIL_LIMITS.maxDimensionPixels,
              height: SESSION_RESOURCE_THUMBNAIL_LIMITS.maxDimensionPixels,
              fit: 'inside',
              withoutEnlargement: true,
            })
            .webp(THUMBNAIL_WEBP_OPTIONS)
            .toBuffer()
          if (
            thumbnail.byteLength === 0 ||
            thumbnail.byteLength > SESSION_RESOURCE_THUMBNAIL_LIMITS.maxBytes
          ) {
            throw new Error('Generated thumbnail exceeds the output size limit.')
          }
          return { bytes: thumbnail, mimeType: 'image/webp' as const }
        },
        catch: thumbnailError,
      }),
  }
}

export const SharpSessionResourceThumbnailerLive = Layer.succeed(
  SessionResourceThumbnailer,
  SessionResourceThumbnailer.of(createSharpSessionResourceThumbnailer()),
)
