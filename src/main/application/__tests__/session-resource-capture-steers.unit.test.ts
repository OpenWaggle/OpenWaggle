import type { AgentSendPayload, Message } from '@shared/types/agent'
import { MessageId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { captureSuccessfulRunResources } from '../session-resource-capture'
import { sessionResourceTestLayer } from './session-resource-capture.fixtures'

describe('accepted steer resource capture', () => {
  it('captures an accepted image steer on its persisted user node, not the initial message', async () => {
    const upserts: UpsertSessionResourceInput[] = []
    const steerPayload: AgentSendPayload = {
      text: 'Inspect this image',
      thinkingLevel: 'medium',
      attachments: [
        {
          id: 'steered-image',
          kind: 'image',
          name: 'steered.png',
          path: '/input/steered.png',
          mimeType: 'image/png',
          sizeBytes: 42,
          extractedText: '',
        },
      ],
    }
    const messages: Message[] = [
      {
        id: MessageId('initial-user'),
        role: 'user',
        parts: [{ type: 'text', text: 'Start' }],
        createdAt: 1000,
      },
      {
        id: MessageId('steered-user'),
        role: 'user',
        parts: [
          { type: 'text', text: 'Inspect this image\n\n[Attachment: steered.png]' },
          { type: 'text', text: '[Image input: image/png]' },
        ],
        createdAt: 2000,
      },
    ]

    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-steer',
        payload: { text: 'Start', thinkingLevel: 'medium', attachments: [] },
        messages,
        nodeIdByMessageId: {
          'initial-user': 'initial-node',
          'steered-user': 'steered-node',
        },
        acceptedSteers: [
          { payload: steerPayload, durableText: 'Inspect this image\n\n[Attachment: steered.png]' },
        ],
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts))),
    )

    expect(upserts).toContainEqual(
      expect.objectContaining({
        kind: 'image',
        title: 'steered.png',
        occurrence: expect.objectContaining({
          id: 'session-1:steered-node:provided:attachment:steered-image:0',
          nodeId: 'steered-node',
          label: 'steered.png',
        }),
      }),
    )
    expect(upserts.some(({ occurrence }) => occurrence.nodeId === 'initial-node')).toBe(false)
  })

  it('does not attach an accepted steer to a different persisted user message', async () => {
    const upserts: UpsertSessionResourceInput[] = []
    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-unmatched-steer',
        payload: { text: 'Start', thinkingLevel: 'medium', attachments: [] },
        messages: [
          {
            id: MessageId('initial-user'),
            role: 'user',
            parts: [{ type: 'text', text: 'Start' }],
            createdAt: 1000,
          },
          {
            id: MessageId('other-user'),
            role: 'user',
            parts: [{ type: 'text', text: 'Another message' }],
            createdAt: 2000,
          },
        ],
        acceptedSteers: [
          {
            durableText: 'Missing steer',
            payload: {
              text: 'Missing steer',
              thinkingLevel: 'medium',
              attachments: [
                {
                  id: 'unmatched-image',
                  kind: 'image',
                  name: 'unmatched.png',
                  path: '/input/unmatched.png',
                  mimeType: 'image/png',
                  sizeBytes: 42,
                  extractedText: '',
                },
              ],
            },
          },
        ],
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts))),
    )

    expect(upserts).toEqual([])
  })

  it('captures a Host steer link from its durable user turn without a transient payload', async () => {
    const upserts: UpsertSessionResourceInput[] = []
    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-host-steer',
        payload: { text: 'Start', thinkingLevel: 'medium', attachments: [] },
        messages: [
          {
            id: MessageId('initial-user'),
            role: 'user',
            parts: [{ type: 'text', text: 'Start' }],
            createdAt: 1000,
          },
          {
            id: MessageId('host-steer'),
            role: 'user',
            parts: [{ type: 'text', text: 'Check [the spec](https://example.test/spec)' }],
            createdAt: 2000,
          },
        ],
        nodeIdByMessageId: { 'host-steer': 'durable-steer-node' },
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts))),
    )

    expect(upserts).toContainEqual(
      expect.objectContaining({
        kind: 'link',
        occurrence: expect.objectContaining({ nodeId: 'durable-steer-node', actor: 'user' }),
      }),
    )
  })
})
