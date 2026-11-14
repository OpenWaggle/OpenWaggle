import { Schema, safeDecodeUnknown } from '@shared/schema'
import type { SessionId } from '@shared/types/brand'
import type { SessionResourceThumbnailPreview } from '@shared/types/session-resource'
import { MAX_CAPTURED_IMAGE_BYTES } from '../domain/session-resource-image'
import { invokeConfiguredHostUiRaw } from './gui-session-command-router'

export type HostSessionResourceContentResult =
  | { readonly handled: false }
  | {
      readonly handled: true
      readonly content: {
        readonly resourceId: string
        readonly fileName: string
        readonly mimeType: string
        readonly bytes: Uint8Array
      } | null
    }

const hostImageContentSchema = Schema.Struct({
  resourceId: Schema.String,
  fileName: Schema.String,
  mimeType: Schema.String.pipe(
    Schema.filter((mimeType) => mimeType.toLowerCase().startsWith('image/')),
  ),
  dataBase64: Schema.String,
})

function decodeHostImageContent(value: unknown, error: string) {
  const decoded = safeDecodeUnknown(hostImageContentSchema, value)
  if (!decoded.success) throw new Error(error)
  return decoded.data
}

function decodeBase64Image(value: string) {
  const bytes = Buffer.from(value, 'base64')
  return bytes.byteLength > 0 && bytes.byteLength <= MAX_CAPTURED_IMAGE_BYTES ? bytes : null
}

export async function readHostSessionResourceContent(sessionId: SessionId, resourceId: string) {
  const response = await invokeConfiguredHostUiRaw('sessions:resources:host-content', [
    sessionId,
    resourceId,
  ])
  if (!response.handled) return response
  if (response.result === null) return { handled: true, content: null }
  const INVALID_CONTENT = 'The Session Host returned invalid image content.'
  const content = decodeHostImageContent(response.result, INVALID_CONTENT)
  const bytes = decodeBase64Image(content.dataBase64)
  if (!bytes) throw new Error(INVALID_CONTENT)
  return {
    handled: true,
    content: {
      resourceId: content.resourceId,
      fileName: content.fileName,
      mimeType: content.mimeType,
      bytes,
    },
  } satisfies HostSessionResourceContentResult
}

export async function readHostSessionResourceThumbnail(sessionId: SessionId, resourceId: string) {
  const response = await invokeConfiguredHostUiRaw('sessions:resources:thumbnail', [
    sessionId,
    resourceId,
  ])
  if (!response.handled) return response
  if (response.result === null) return { handled: true, thumbnail: null }
  const INVALID_THUMBNAIL = 'The Session Host returned an invalid image thumbnail.'
  const thumbnail = decodeHostImageContent(response.result, INVALID_THUMBNAIL)
  if (!decodeBase64Image(thumbnail.dataBase64)) throw new Error(INVALID_THUMBNAIL)
  return {
    handled: true,
    thumbnail: {
      resourceId: thumbnail.resourceId,
      fileName: thumbnail.fileName,
      mimeType: thumbnail.mimeType,
      dataBase64: thumbnail.dataBase64,
    },
  } satisfies
    | { readonly handled: false }
    | { readonly handled: true; readonly thumbnail: SessionResourceThumbnailPreview | null }
}
