import type { PreparedAttachment } from '@shared/types/agent'
import { fromAny } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  loadAttachmentHandlers,
  registeredHandler,
  registerFile,
  resetAttachmentHandlerMocks,
  showMessageBoxMock,
} from './attachments-handler.test-harness'

describe('registerAttachmentHandlers limits and hydration', () => {
  let hydrateAttachmentSources: Awaited<
    ReturnType<typeof loadAttachmentHandlers>
  >['hydrateAttachmentSources']
  let registerAttachmentHandlers: Awaited<
    ReturnType<typeof loadAttachmentHandlers>
  >['registerAttachmentHandlers']

  beforeEach(async () => {
    resetAttachmentHandlerMocks()
    ;({ hydrateAttachmentSources, registerAttachmentHandlers } = await loadAttachmentHandlers())
  })

  it('rejects unsupported attachment types', async () => {
    registerFile('/tmp/repo/archive.zip', Buffer.from('zip-data'))

    registerAttachmentHandlers()
    const handler = registeredHandler('attachments:prepare')

    await expect(handler?.({}, '/tmp/repo', ['/tmp/repo/archive.zip'])).rejects.toThrow(
      'Unsupported attachment type',
    )
  })

  it('rejects attachments larger than per-file limit', async () => {
    registerFile('/tmp/repo/huge.txt', Buffer.from('small-buffer'), 9 * 1024 * 1024)

    registerAttachmentHandlers()
    const handler = registeredHandler('attachments:prepare')

    await expect(handler?.({}, '/tmp/repo', ['/tmp/repo/huge.txt'])).rejects.toThrow(
      'Attachment exceeds 8 MB',
    )
  })

  it('rejects payloads that exceed total size limit', async () => {
    registerFile('/tmp/repo/a.txt', Buffer.from('a'), 12 * 1024 * 1024)
    registerFile('/tmp/repo/b.txt', Buffer.from('b'), 12 * 1024 * 1024)

    registerAttachmentHandlers()
    const handler = registeredHandler('attachments:prepare')

    await expect(
      handler?.({}, '/tmp/repo', ['/tmp/repo/a.txt', '/tmp/repo/b.txt']),
    ).rejects.toThrow('Total attachment size exceeds 20 MB')
  })

  it('accepts user-selected screenshot files outside the selected project root', async () => {
    const screenshotPath = '/tmp/Desktop/Screenshot 2026-05-14 at 1.23.45 PM.png'
    registerFile(screenshotPath, Buffer.from('fake-screenshot-bytes'))

    registerAttachmentHandlers()
    const handler = registeredHandler('attachments:prepare')

    const result = await handler?.({}, '/tmp/repo', [screenshotPath])

    expect(result).toEqual([
      expect.objectContaining({
        kind: 'image',
        origin: 'user-file',
        name: 'Screenshot 2026-05-14 at 1.23.45 PM.png',
        path: screenshotPath,
        mimeType: 'image/png',
        extractedText: 'OCR extracted text',
      }),
    ])
    expect(showMessageBoxMock).not.toHaveBeenCalled()
  })

  it('hydrates binary source for image/pdf attachments in main process', async () => {
    registerFile('/tmp/repo/diagram.png', Buffer.from('image-bytes'))
    registerFile('/tmp/repo/spec.pdf', Buffer.from('pdf-bytes'))
    registerFile('/tmp/repo/notes.txt', Buffer.from('notes'))

    registerAttachmentHandlers()
    const handler = registeredHandler('attachments:prepare')
    const prepared = fromAny<PreparedAttachment[], unknown>(
      await handler?.({}, '/tmp/repo', [
        '/tmp/repo/diagram.png',
        '/tmp/repo/spec.pdf',
        '/tmp/repo/notes.txt',
      ]),
    )

    const hydrated = await hydrateAttachmentSources(prepared)

    expect(hydrated[0]).toMatchObject({
      kind: 'image',
      source: { type: 'data', mimeType: 'image/png' },
    })
    expect(hydrated[1]).toMatchObject({
      kind: 'pdf',
      source: { type: 'data', mimeType: 'application/pdf' },
    })
    expect(hydrated[2]).toMatchObject({
      kind: 'text',
      source: null,
    })
  })
})
