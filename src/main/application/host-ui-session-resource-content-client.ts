import type { SessionId } from '@shared/types/brand'
import type { SessionResourceThumbnailPreview } from '@shared/types/session-resource'
import { isRecord } from '@shared/utils/validation'
import { MAX_CAPTURED_IMAGE_BYTES } from '../domain/session-resource-image'
import { invokeConfiguredHostUiRaw } from './local-session-command-dispatcher'

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

function decodeBase64Image(value: unknown) {
  if (typeof value !== 'string') return null
  const bytes = Buffer.from(value, 'base64')
  return bytes.byteLength > 0 && bytes.byteLength <= MAX_CAPTURED_IMAGE_BYTES ? bytes : null
}

export async function readHostSessionResourceContent(
  sessionId: SessionId,
  resourceId: string,
): Promise<HostSessionResourceContentResult> {
  const response = await invokeConfiguredHostUiRaw('sessions:resources:host-content', [
    sessionId,
    resourceId,
  ])
  if (!response.handled) return response
  if (response.result === null) return { handled: true, content: null }
  if (
    !isRecord(response.result) ||
    typeof response.result.resourceId !== 'string' ||
    typeof response.result.fileName !== 'string' ||
    typeof response.result.mimeType !== 'string' ||
    !response.result.mimeType.toLowerCase().startsWith('image/')
  ) {
    throw new Error('The Session Host returned invalid image content.')
  }
  const bytes = decodeBase64Image(response.result.dataBase64)
  if (!bytes) throw new Error('The Session Host returned invalid image content.')
  return {
    handled: true,
    content: {
      resourceId: response.result.resourceId,
      fileName: response.result.fileName,
      mimeType: response.result.mimeType,
      bytes,
    },
  }
}

export async function readHostSessionResourceThumbnail(
  sessionId: SessionId,
  resourceId: string,
): Promise<
  | { readonly handled: false }
  | { readonly handled: true; readonly thumbnail: SessionResourceThumbnailPreview | null }
> {
  const response = await invokeConfiguredHostUiRaw('sessions:resources:thumbnail', [
    sessionId,
    resourceId,
  ])
  if (!response.handled) return response
  if (response.result === null) return { handled: true, thumbnail: null }
  if (
    !isRecord(response.result) ||
    typeof response.result.resourceId !== 'string' ||
    typeof response.result.fileName !== 'string' ||
    typeof response.result.mimeType !== 'string' ||
    !response.result.mimeType.toLowerCase().startsWith('image/') ||
    typeof response.result.dataBase64 !== 'string' ||
    !decodeBase64Image(response.result.dataBase64)
  ) {
    throw new Error('The Session Host returned an invalid image thumbnail.')
  }
  return {
    handled: true,
    thumbnail: {
      resourceId: response.result.resourceId,
      fileName: response.result.fileName,
      mimeType: response.result.mimeType,
      dataBase64: response.result.dataBase64,
    },
  }
}
