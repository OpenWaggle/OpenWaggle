import { ATTACHMENT } from '@shared/constants/resource-limits'
import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import { preparedAttachmentSchema } from '@shared/schemas/validation'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  files,
  loadAttachmentHandlers,
  registeredHandler,
  resetAttachmentHandlerMocks,
} from './attachments-handler.test-harness'

const preparedAttachmentsSchema = Schema.Array(preparedAttachmentSchema)

function bytesOf(text: string) {
  return new TextEncoder().encode(text)
}

/** The system webviews give a picked `File` no path; the page sends its content instead. */
describe('attachments:prepare-files', () => {
  beforeEach(async () => {
    resetAttachmentHandlerMocks()
    const { registerAttachmentHandlers } = await loadAttachmentHandlers()
    registerAttachmentHandlers()
  })

  it('stages each file under its own name and prepares it as a user file', async () => {
    const handler = registeredHandler('attachments:prepare-files')
    const result = decodeUnknownExactOrThrow(
      preparedAttachmentsSchema,
      await handler?.({}, '/tmp/repo', [
        { name: 'notes.txt', bytes: bytesOf('Hello from notes') },
        { name: 'notes.txt', bytes: bytesOf('Another note') },
      ]),
    )

    expect(
      result.map(({ name, origin, extractedText }) => ({ name, origin, extractedText })),
    ).toEqual([
      { name: 'notes.txt', origin: 'user-file', extractedText: 'Hello from notes' },
      { name: 'notes.txt', origin: 'user-file', extractedText: 'Another note' },
    ])
    const [first, second] = result
    expect(first?.path).not.toBe(second?.path)
    expect(files.get(first?.path ?? '')?.content.toString('utf8')).toBe('Hello from notes')
  })

  it.each([
    ['a name with a directory', [{ name: '../escape.txt', bytes: bytesOf('x') }]],
    ['a dot segment', [{ name: '..', bytes: bytesOf('x') }]],
    ['an empty name', [{ name: '', bytes: bytesOf('x') }]],
    ['content that is not bytes', [{ name: 'a.txt', bytes: 'x' }]],
    [
      'a file over the size limit',
      [{ name: 'big.bin', bytes: new Uint8Array(ATTACHMENT.MAX_SIZE_BYTES + 1) }],
    ],
    [
      'more files than a message holds',
      Array.from({ length: ATTACHMENT.MAX_COUNT + 1 }, (_, index) => ({
        name: `f${String(index)}.txt`,
        bytes: bytesOf('x'),
      })),
    ],
  ])('refuses %s and stages nothing', async (_label, selected) => {
    const handler = registeredHandler('attachments:prepare-files')
    const before = files.size

    await expect(handler?.({}, '/tmp/repo', selected)).rejects.toThrow()
    expect(files.size).toBe(before)
  })
})
