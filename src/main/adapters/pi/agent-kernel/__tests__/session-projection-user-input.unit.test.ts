import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { expect, it } from 'vitest'
import { projectPiSessionSnapshot } from '../session-projection'

it('projects original attachment display parts instead of Pi prompt artifacts', () => {
  const attachment = {
    id: 'attachment-1',
    kind: 'image' as const,
    origin: 'user-file' as const,
    name: 'screenshot.png',
    path: '/tmp/screenshot.png',
    mimeType: 'image/png',
    sizeBytes: 128,
    contentSha256: 'a'.repeat(64),
    extractedText: '',
  }
  const timestamp = '2026-05-19T10:00:00.000Z'
  const entries = [
    {
      id: 'display',
      parentId: null,
      timestamp,
      type: 'custom',
      customType: 'openwaggle-user-input',
      data: {
        version: 1,
        parts: [
          { type: 'text', text: 'Fix this layout' },
          { type: 'attachment', attachment },
        ],
      },
    },
    {
      id: 'prompt',
      parentId: 'display',
      timestamp,
      type: 'message',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'Fix this layout\n\n[Attachment: screenshot.png]' },
          { type: 'image', data: 'base64-image', mimeType: 'image/png' },
        ],
        timestamp: 1,
      },
    },
  ] satisfies SessionEntry[]

  const snapshot = projectPiSessionSnapshot({
    sessionManager: { getEntries: () => entries, getLeafId: () => 'prompt' },
  })

  expect(JSON.parse(snapshot.nodes[1]?.contentJson ?? '{}')).toEqual({
    parts: [
      { type: 'text', text: 'Fix this layout' },
      { type: 'attachment', attachment },
    ],
    model: null,
  })
  expect(snapshot.nodes[1]?.contentJson).not.toContain('[Attachment:')
  expect(snapshot.nodes[1]?.contentJson).not.toContain('[Image input:')
})
