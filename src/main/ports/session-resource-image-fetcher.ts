import { Context, type Effect } from 'effect'
import type { SessionResourceImageFetchError } from '../errors'

export interface FetchedSessionResourceImage {
  readonly bytes: Uint8Array
  readonly mimeType: string
  readonly fileName: string
}

export interface SessionResourceImageFetcherShape {
  readonly fetch: (
    url: string,
  ) => Effect.Effect<FetchedSessionResourceImage, SessionResourceImageFetchError>
}

export class SessionResourceImageFetcher extends Context.Tag(
  '@openwaggle/SessionResourceImageFetcher',
)<SessionResourceImageFetcher, SessionResourceImageFetcherShape>() {}
