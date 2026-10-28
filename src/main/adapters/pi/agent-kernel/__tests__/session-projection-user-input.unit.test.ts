import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { ATTACHMENT } from '@shared/constants/resource-limits'
import { boundedAttachmentText } from '@shared/utils/attachment-text'
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
        durableTextSha256: 'a'.repeat(64),
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
  expect(JSON.parse(snapshot.nodes[1]?.metadataJson ?? '{}')).toEqual({
    durableTextSha256: 'a'.repeat(64),
  })
  expect(snapshot.nodes[1]?.contentJson).not.toContain('[Attachment:')
  expect(snapshot.nodes[1]?.contentJson).not.toContain('[Image input:')
})

it('projects the Scheduled task a prompt came from into its user node metadata', () => {
  const timestamp = '2026-05-19T10:00:00.000Z'
  const scheduledTask = { taskId: 'task-1', name: 'Morning triage', kind: 'heartbeat' }
  const entries = [
    {
      id: 'display',
      parentId: null,
      timestamp,
      type: 'custom',
      customType: 'openwaggle-user-input',
      data: { version: 1, parts: [{ type: 'text', text: 'Check CI' }], scheduledTask },
    },
    {
      id: 'prompt',
      parentId: 'display',
      timestamp,
      type: 'message',
      message: { role: 'user', content: [{ type: 'text', text: 'Check CI' }], timestamp: 1 },
    },
    {
      id: 'typed',
      parentId: 'prompt',
      timestamp,
      type: 'message',
      message: { role: 'user', content: [{ type: 'text', text: 'Thanks' }], timestamp: 2 },
    },
  ] satisfies SessionEntry[]

  const snapshot = projectPiSessionSnapshot({
    sessionManager: { getEntries: () => entries, getLeafId: () => 'typed' },
  })

  expect(JSON.parse(snapshot.nodes[1]?.metadataJson ?? '{}')).toEqual({ scheduledTask })
  expect(JSON.parse(snapshot.nodes[2]?.metadataJson ?? '{}')).not.toHaveProperty('scheduledTask')
})

it('ignores a malformed Scheduled task record instead of trusting it', () => {
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
        parts: [{ type: 'text', text: 'Check CI' }],
        scheduledTask: { name: 'No id', kind: 'cron' },
      },
    },
    {
      id: 'prompt',
      parentId: 'display',
      timestamp,
      type: 'message',
      message: { role: 'user', content: [{ type: 'text', text: 'Check CI' }], timestamp: 1 },
    },
  ] satisfies SessionEntry[]

  const snapshot = projectPiSessionSnapshot({
    sessionManager: { getEntries: () => entries, getLeafId: () => 'prompt' },
  })

  expect(snapshot.nodes[1]?.metadataJson ?? '{}').not.toContain('scheduledTask')
})

it('keeps the pasted prompt of a projection recorded with its whole text, bounded', () => {
  // Projections recorded before display parts were bounded hold an auto-paste's whole prompt.
  const prompt = 'pasted line\n'.repeat(10_000)
  const attachment = {
    id: 'attachment-pasted',
    kind: 'text' as const,
    origin: 'auto-paste-text' as const,
    name: 'prompt-1.md',
    path: '/tmp/prompt-1.md',
    mimeType: 'text/markdown',
    sizeBytes: prompt.length,
    extractedText: prompt,
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
          { type: 'text', text: 'Redesign this' },
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
        content: [{ type: 'text', text: `Redesign this\n\n[Attachment: prompt-1.md]\n${prompt}` }],
        timestamp: 1,
      },
    },
  ] satisfies SessionEntry[]

  const snapshot = projectPiSessionSnapshot({
    sessionManager: { getEntries: () => entries, getLeafId: () => 'prompt' },
  })

  expect(JSON.parse(snapshot.nodes[1]?.contentJson ?? '{}').parts).toEqual([
    { type: 'text', text: 'Redesign this' },
    {
      type: 'attachment',
      attachment: { ...attachment, extractedText: boundedAttachmentText(prompt) },
    },
  ])
  expect(boundedAttachmentText(prompt).length).toBe(ATTACHMENT.MAX_EXTRACTED_TEXT_CHARS)
})
