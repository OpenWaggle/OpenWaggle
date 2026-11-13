import { ATTACHMENT } from '@shared/constants/resource-limits'
import { describe, expect, it, vi } from 'vitest'
import {
  decodeAssistantMessageSnapshots,
  decodeStreamingParts,
} from '../local-session-snapshot-parts'

const logged = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }))
vi.mock('../../logger', () => ({ createLogger: () => logged }))

const SECRET = 'rm -rf /very/secret/path'
const context = { sessionId: 'session-1', runId: 'run-1' }
const undecodable = {
  type: 'tool-call',
  toolCall: {
    id: 'code-1',
    name: 'codemode',
    args: { command: SECRET },
    nestedCalls: {
      calls: [{ id: 'x', name: 'bash', args: { command: SECRET }, status: 'pending' }],
      complete: false,
    },
  },
}

describe('snapshot part decode reports', () => {
  it('logs one line per dropped part with where it failed, never what it held', () => {
    logged.error.mockClear()
    decodeStreamingParts(
      { parts: [{ type: 'text', text: SECRET }, undecodable], messageId: 'm' },
      context,
    )

    expect(logged.error).toHaveBeenCalledTimes(1)
    const [message, data] = logged.error.mock.calls[0] ?? []
    expect(message).toMatch(/streaming message part/)
    expect(data).toMatchObject({
      sessionId: 'session-1',
      runId: 'run-1',
      messageId: 'm',
      partIndex: 1,
      partType: 'tool-call',
    })
    expect(data?.issues).toEqual(expect.arrayContaining([expect.stringMatching(/^toolCall\./)]))
    expect(JSON.stringify(data)).not.toContain('secret')
  })

  it('names the earlier assistant message it leaves out, without its content', () => {
    logged.error.mockClear()
    decodeAssistantMessageSnapshots(
      [{ messageId: 'assistant-1', timestamp: 1, parts: [undecodable] }],
      context,
    )

    expect(logged.error).toHaveBeenCalledWith(
      expect.stringMatching(/earlier assistant message/),
      expect.objectContaining({ sessionId: 'session-1', messageId: 'assistant-1' }),
    )
    expect(JSON.stringify(logged.error.mock.calls)).not.toContain('secret')
  })
})

// Snapshot parts decode with the transcript's own part schema, so an attachment is held to the
// bounds the window prepared it under; the snapshot's own copy accepted any size.
describe('snapshot attachment parts', () => {
  const attachment = {
    id: 'attachment-1',
    kind: 'text',
    name: 'notes.md',
    path: '/repo/notes.md',
    mimeType: 'text/markdown',
    sizeBytes: 12,
    extractedText: 'notes',
  }

  it('keeps an attachment within the prepared bounds', () => {
    const decoded = decodeStreamingParts({ parts: [{ type: 'attachment', attachment }] }, context)
    expect(decoded).toMatchObject({ dropped: false, parts: [{ type: 'attachment', attachment }] })
  })

  it('drops an attachment over the size bound, naming the field', () => {
    logged.error.mockClear()
    const oversized = { ...attachment, sizeBytes: ATTACHMENT.MAX_SIZE_BYTES + 1 }
    const decoded = decodeStreamingParts(
      { parts: [{ type: 'attachment', attachment: oversized }] },
      context,
    )
    expect(decoded.dropped).toBe(true)
    expect(logged.error.mock.calls[0]?.[1]?.issues).toEqual(
      expect.arrayContaining([expect.stringMatching(/^attachment\.sizeBytes: /u)]),
    )
  })
})
