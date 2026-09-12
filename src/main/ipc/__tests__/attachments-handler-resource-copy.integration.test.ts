import { ATTACHMENT } from '@shared/constants/resource-limits'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  files,
  loadAttachmentHandlers,
  ocrRecognizeMock,
  registeredHandler,
  resetAttachmentHandlerMocks,
  writeFileMock,
} from './attachments-handler.test-harness'

const PRIVATE_ATTACHMENT_FILE_MODE = 0o600

describe('managed Session resource attachment copies', () => {
  let prepareRegisteredImageAttachmentFromBytes: Awaited<
    ReturnType<typeof loadAttachmentHandlers>
  >['prepareRegisteredImageAttachmentFromBytes']
  let discardRegisteredImageAttachment: Awaited<
    ReturnType<typeof loadAttachmentHandlers>
  >['discardRegisteredImageAttachment']
  let hydrateAttachmentSources: Awaited<
    ReturnType<typeof loadAttachmentHandlers>
  >['hydrateAttachmentSources']
  let registerAttachmentHandlers: Awaited<
    ReturnType<typeof loadAttachmentHandlers>
  >['registerAttachmentHandlers']

  beforeEach(async () => {
    resetAttachmentHandlerMocks()
    ;({
      discardRegisteredImageAttachment,
      hydrateAttachmentSources,
      prepareRegisteredImageAttachmentFromBytes,
      registerAttachmentHandlers,
    } = await loadAttachmentHandlers())
    registerAttachmentHandlers()
  })

  it('registers an isolated private copy without exposing the managed store path', async () => {
    const bytes = Buffer.from('resource-image-bytes')
    const attachment = await prepareRegisteredImageAttachmentFromBytes({
      bytes,
      fileName: 'Architecture diagram',
      mimeType: 'image/png',
    })

    expect(attachment).toMatchObject({
      kind: 'image',
      origin: 'user-file',
      name: 'Architecture diagram.png',
      mimeType: 'image/png',
      sizeBytes: bytes.byteLength,
      extractedText: 'OCR extracted text',
      path: expect.stringMatching(
        /^\/tmp\/user-data\/temp-attachments\/resource-[0-9a-f-]+\.png$/u,
      ),
    })
    expect(attachment.path).not.toContain('Architecture diagram')
    expect(ocrRecognizeMock).toHaveBeenCalledWith(bytes, 'eng')
    expect(writeFileMock).toHaveBeenCalledWith(attachment.path, bytes, {
      flag: 'wx',
      mode: PRIVATE_ATTACHMENT_FILE_MODE,
    })
  })

  it('replaces a misleading display extension with the validated image type', async () => {
    const attachment = await prepareRegisteredImageAttachmentFromBytes({
      bytes: Buffer.from('resource-image-bytes'),
      fileName: 'notes.txt',
      mimeType: 'image/webp',
    })

    expect(attachment).toMatchObject({
      name: 'notes.webp',
      mimeType: 'image/webp',
      path: expect.stringMatching(/\.webp$/u),
    })
  })

  it('revokes and deletes an isolated copy that is discarded before delivery', async () => {
    const attachment = await prepareRegisteredImageAttachmentFromBytes({
      bytes: Buffer.from('resource-image-bytes'),
      fileName: 'Architecture diagram.png',
      mimeType: 'image/png',
    })

    await discardRegisteredImageAttachment(attachment)

    expect(files.has(attachment.path)).toBe(false)
    await expect(hydrateAttachmentSources([attachment])).rejects.toThrow(
      'Attachment was not prepared by this app',
    )
  })

  it('rejects forged discard requests without deleting a prepared image capability', async () => {
    const attachment = await prepareRegisteredImageAttachmentFromBytes({
      bytes: Buffer.from('resource-image-bytes'),
      fileName: 'Architecture diagram.png',
      mimeType: 'image/png',
    })
    const discard = registeredHandler('attachments:discard')
    if (!discard) throw new Error('Expected the attachment discard handler.')

    await expect(
      discard({}, { ...attachment, sizeBytes: attachment.sizeBytes + 1 }),
    ).rejects.toThrow('does not match prepared capability')

    expect(files.has(attachment.path)).toBe(true)
    await expect(hydrateAttachmentSources([attachment])).resolves.toHaveLength(1)
  })

  it('rejects oversized bytes before creating an isolated copy', async () => {
    await expect(
      prepareRegisteredImageAttachmentFromBytes({
        bytes: new Uint8Array(ATTACHMENT.MAX_SIZE_BYTES + 1),
        fileName: 'large.png',
        mimeType: 'image/png',
      }),
    ).rejects.toThrow('Attachment exceeds 8 MB')

    expect(ocrRecognizeMock).not.toHaveBeenCalled()
    expect(writeFileMock).not.toHaveBeenCalled()
  })
})
