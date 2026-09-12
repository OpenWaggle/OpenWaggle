import { ATTACHMENT } from '@shared/constants/resource-limits'
import { decodeUnknownExactOrThrow } from '@shared/schema'
import { agentSendPayloadSchema, preparedAttachmentSchema } from '@shared/schemas/validation'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  broadcastToWindowsMock,
  files,
  loadAttachmentHandlers,
  openMock,
  readdirMock,
  registeredHandler,
  resetAttachmentHandlerMocks,
} from './attachments-handler.test-harness'

describe('attachments:prepare-from-text', () => {
  let registerAttachmentHandlers: Awaited<
    ReturnType<typeof loadAttachmentHandlers>
  >['registerAttachmentHandlers']

  beforeEach(async () => {
    resetAttachmentHandlerMocks()
    ;({ registerAttachmentHandlers } = await loadAttachmentHandlers())
  })

  it('stores full long text and returns a bounded preview accepted by submission', async () => {
    registerAttachmentHandlers()
    const handler = registeredHandler('attachments:prepare-from-text')
    expect(handler).toBeDefined()

    const longText = 'x'.repeat(50_000)
    const result = decodeUnknownExactOrThrow(
      preparedAttachmentSchema,
      await handler?.({}, longText, 'operation-1'),
    )

    expect(result).toMatchObject({
      kind: 'text',
      origin: 'auto-paste-text',
      mimeType: 'text/markdown',
    })
    expect(result.extractedText.length).toBe(ATTACHMENT.MAX_EXTRACTED_TEXT_CHARS)
    expect(result.extractedText).toMatch(/\n\.\.\.\[truncated\]$/)
    expect(files.get(result.path)?.content.toString('utf8')).toBe(longText)
    expect(() =>
      decodeUnknownExactOrThrow(agentSendPayloadSchema, {
        text: '',
        thinkingLevel: 'off',
        attachments: [result],
      }),
    ).not.toThrow()
    expect(result).toEqual(
      expect.objectContaining({
        name: expect.stringMatching(/^prompt-\d+\.md$/),
      }),
    )
    expect(openMock).toHaveBeenCalledTimes(2)
    const progressCalls = broadcastToWindowsMock.mock.calls.filter(
      (call: unknown[]) => call[0] === 'attachments:prepare-from-text-progress',
    )
    expect(progressCalls.length).toBeGreaterThan(1)
    const lastProgressCall = progressCalls[progressCalls.length - 1]
    expect(lastProgressCall?.[1]).toMatchObject({
      operationId: 'operation-1',
      stage: 'completed',
      progressPercent: 100,
    })
  })

  it('rejects empty text input', async () => {
    registerAttachmentHandlers()
    const handler = registeredHandler('attachments:prepare-from-text')

    await expect(handler?.({}, '', 'operation-2')).rejects.toThrow()
  })

  it('rejects text input larger than the per-attachment limit', async () => {
    registerAttachmentHandlers()
    const handler = registeredHandler('attachments:prepare-from-text')
    const oversizedText = 'x'.repeat(ATTACHMENT.MAX_SIZE_BYTES + 1)

    await expect(handler?.({}, oversizedText, 'operation-oversized')).rejects.toThrow(
      'Generated attachment exceeds 8 MB.',
    )
  })

  it('runs cleanup on registration and ignores cleanup errors', async () => {
    readdirMock.mockRejectedValueOnce(new Error('cleanup failed'))

    registerAttachmentHandlers()
    await Promise.resolve()

    expect(registeredHandler('attachments:prepare')).toBeDefined()
    expect(registeredHandler('attachments:prepare-from-text')).toBeDefined()
  })
})
