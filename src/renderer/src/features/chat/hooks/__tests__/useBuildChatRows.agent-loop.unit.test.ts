import { SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { buildChatRows } from './useBuildChatRows.test-utils'

describe('buildChatRows agent-loop events', () => {
  it('appends custom messages and interaction events to the transcript audit trail', () => {
    const rows = buildChatRows({
      messages: [],
      customMessages: [
        {
          type: 'custom',
          timestamp: 1,
          name: 'openwaggle.github.issues',
          value: { count: 0 },
        },
      ],
      interactionEvents: [
        {
          type: 'agent_interaction_request',
          timestamp: 2,
          interaction: {
            interactionId: 'interaction-1',
            sessionId: SessionId('session-1'),
            runId: 'run-1',
            kind: 'confirm',
            source: 'pi-ui',
            createdAt: 2,
            title: 'Continue?',
            message: 'Proceed with action?',
          },
        },
        {
          type: 'agent_interaction_resolved',
          timestamp: 3,
          runId: 'run-1',
          interactionId: 'interaction-1',
          kind: 'confirm',
          status: 'resolved',
          response: { kind: 'confirm', accepted: true },
        },
      ],
      isLoading: false,
      error: undefined,
      lastUserMessage: null,
      dismissedError: null,
      sessionId: 'session-1',
      waggleMetadataLookup: {},
      phase: { current: null, completed: [], totalElapsedMs: 0 },
    })

    expect(rows.map((row) => row.type)).toEqual([
      'agent-loop-custom-message',
      'agent-loop-interaction-event',
      'agent-loop-interaction-event',
    ])
  })
})
