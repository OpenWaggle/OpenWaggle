import type { SessionId } from '@shared/types/brand'
import { Context, type Effect } from 'effect'
import type { SessionResourceStoreError } from '../errors'

export interface StoredSessionResourceFile {
  readonly path: string
  readonly sha256: string
  readonly sizeBytes: number
}

export interface StoreSessionResourceBytesInput {
  readonly sessionId: SessionId
  readonly resourceId: string
  readonly fileName: string
  readonly bytes: Uint8Array
}

export interface StoreSessionResourceFileInput {
  readonly sessionId: SessionId
  readonly resourceId: string
  readonly fileName: string
  readonly sourcePath: string
  readonly expectedSizeBytes: number
  readonly expectedSha256?: string
  readonly maxSizeBytes: number
}

export interface SessionResourceStoreShape {
  readonly storeBytes: (
    input: StoreSessionResourceBytesInput,
  ) => Effect.Effect<StoredSessionResourceFile, SessionResourceStoreError>
  readonly storeFile: (
    input: StoreSessionResourceFileInput,
  ) => Effect.Effect<StoredSessionResourceFile, SessionResourceStoreError>
  readonly read: (managedPath: string) => Effect.Effect<Uint8Array, SessionResourceStoreError>
  readonly remove: (managedPath: string) => Effect.Effect<void, SessionResourceStoreError>
  readonly removeSession: (sessionId: SessionId) => Effect.Effect<void, SessionResourceStoreError>
}

export class SessionResourceStore extends Context.Tag('@openwaggle/SessionResourceStore')<
  SessionResourceStore,
  SessionResourceStoreShape
>() {}
