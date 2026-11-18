import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { expect, it } from 'vitest'
import { projectionForPiEntry } from '../entry-projections'

it('projects clean attachment parts for a visible Waggle request', () => {
  const entry = {
    id: 'waggle-user',
    parentId: null,
    timestamp: '2026-05-19T10:00:00.000Z',
    type: 'custom_message',
    customType: 'pi-waggle.user-request',
    content: 'Coordinate these agents.\n\n[Attachment: screenshot.png]',
    details: {
      userInput: {
        version: 1,
        parts: [
          { type: 'text', text: 'Coordinate these agents.' },
          {
            type: 'attachment',
            attachment: {
              id: 'image-1',
              kind: 'image',
              name: 'screenshot.png',
              path: '/tmp/screenshot.png',
              mimeType: 'image/png',
              sizeBytes: 4,
              extractedText: '',
            },
          },
        ],
      },
    },
    display: true,
  } satisfies SessionEntry

  const projection = projectionForPiEntry(entry)

  expect(JSON.parse(projection.contentJson)).toMatchObject({
    parts: [
      { type: 'text', text: 'Coordinate these agents.' },
      { type: 'attachment', attachment: { name: 'screenshot.png' } },
    ],
  })
  expect(projection.contentJson).not.toContain('[Attachment:')
})
