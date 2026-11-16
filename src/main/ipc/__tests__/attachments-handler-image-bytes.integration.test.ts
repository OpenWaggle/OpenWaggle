import { decodeUnknownExactOrThrow } from '@shared/schema'
import { preparedAttachmentSchema } from '@shared/schemas/validation'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  files,
  loadAttachmentHandlers,
  registeredHandler,
  resetAttachmentHandlerMocks,
} from './attachments-handler.test-harness'

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

describe('attachments:prepare-image-from-bytes', () => {
  let registerAttachmentHandlers: Awaited<
    ReturnType<typeof loadAttachmentHandlers>
  >['registerAttachmentHandlers']

  beforeEach(async () => {
    resetAttachmentHandlerMocks()
    ;({ registerAttachmentHandlers } = await loadAttachmentHandlers())
  })

  it('prepares a pasted image whose bytes are the only copy', async () => {
    registerAttachmentHandlers()
    const handler = registeredHandler('attachments:prepare-image-from-bytes')
    expect(handler).toBeDefined()

    const result = decodeUnknownExactOrThrow(
      preparedAttachmentSchema,
      await handler?.({}, PNG_BYTES, 'pasted-image.png', 'image/png'),
    )

    expect(result).toMatchObject({
      kind: 'image',
      origin: 'session-resource',
      name: 'pasted-image.png',
      mimeType: 'image/png',
      sizeBytes: PNG_BYTES.byteLength,
    })
    expect(files.get(result.path)?.content).toEqual(Buffer.from(PNG_BYTES))
  })

  it('refuses bytes that are not an image the app can attach', async () => {
    registerAttachmentHandlers()
    const handler = registeredHandler('attachments:prepare-image-from-bytes')

    await expect(handler?.({}, PNG_BYTES, 'notes.txt', 'text/plain')).rejects.toThrow(
      'Unsupported Session image type: text/plain',
    )
  })

  it('refuses a payload that is not a byte array', async () => {
    registerAttachmentHandlers()
    const handler = registeredHandler('attachments:prepare-image-from-bytes')

    await expect(handler?.({}, 'not bytes', 'pasted-image.png', 'image/png')).rejects.toThrow(
      'Attachment image bytes must be a byte array.',
    )
  })
})
