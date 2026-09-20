import { Context, type Effect } from 'effect'
import type { SessionResourceThumbnailError } from '../errors'

export interface SessionResourceThumbnail {
  readonly bytes: Uint8Array
  readonly mimeType: 'image/webp'
}

export interface SessionResourceThumbnailerShape {
  readonly create: (
    bytes: Uint8Array,
    mimeType: string,
  ) => Effect.Effect<SessionResourceThumbnail, SessionResourceThumbnailError>
}

export class SessionResourceThumbnailer extends Context.Tag(
  '@openwaggle/SessionResourceThumbnailer',
)<SessionResourceThumbnailer, SessionResourceThumbnailerShape>() {}
