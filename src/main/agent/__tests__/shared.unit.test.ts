import type { AgentSendPayload, HydratedAgentSendPayload } from '@shared/types/agent'
import { SupportedModelId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'

describe('shared agent helpers', () => {
  describe('makeMessage', () => {
    it('creates a message with required fields', async () => {
      const { makeMessage } = await import('../shared')
      const msg = makeMessage('user', [{ type: 'text', text: 'hello' }])
      expect(msg.role).toBe('user')
      expect(msg.parts).toEqual([{ type: 'text', text: 'hello' }])
      expect(msg.id).toBeTruthy()
      expect(msg.createdAt).toBeGreaterThan(0)
    })

    it('includes optional model', async () => {
      const { makeMessage } = await import('../shared')
      const msg = makeMessage(
        'assistant',
        [{ type: 'text', text: 'hi' }],
        SupportedModelId('gpt-4.1-mini'),
      )
      expect(msg.model).toBe('gpt-4.1-mini')
    })
  })

  describe('buildPersistedUserMessageParts', () => {
    it('builds text parts from payload', async () => {
      const { buildPersistedUserMessageParts } = await import('../shared')
      const payload: AgentSendPayload = {
        text: '  hello world  ',
        thinkingLevel: 'medium',
        attachments: [],
      }
      const parts = buildPersistedUserMessageParts(payload)
      expect(parts).toEqual([{ type: 'text', text: 'hello world' }])
    })

    it('returns empty text part for empty payload', async () => {
      const { buildPersistedUserMessageParts } = await import('../shared')
      const payload: AgentSendPayload = {
        text: '   ',
        thinkingLevel: 'medium',
        attachments: [],
      }
      const parts = buildPersistedUserMessageParts(payload)
      expect(parts).toEqual([{ type: 'text', text: '' }])
    })

    it('strips binary source from attachments', async () => {
      const { buildPersistedUserMessageParts } = await import('../shared')
      const payload: HydratedAgentSendPayload = {
        text: 'check this',
        thinkingLevel: 'medium',
        attachments: [
          {
            id: 'att-1',
            kind: 'image',
            name: 'photo.png',
            path: '/tmp/photo.png',
            mimeType: 'image/png',
            sizeBytes: 1024,
            extractedText: '',
            source: { type: 'data', value: 'base64data', mimeType: 'image/png' },
          },
        ],
      }
      const parts = buildPersistedUserMessageParts(payload)
      expect(parts).toHaveLength(2)
      expect(parts[1]).toEqual({
        type: 'attachment',
        attachment: {
          id: 'att-1',
          kind: 'image',
          name: 'photo.png',
          path: '/tmp/photo.png',
          mimeType: 'image/png',
          sizeBytes: 1024,
          extractedText: '',
        },
      })
    })
  })
})
