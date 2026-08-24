import { SessionId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { buildChatRows } from './useBuildChatRows.test-utils'

describe('buildChatRows agent-loop events', () => {
  it('appends custom messages and coalesces interaction request/resolution pairs', () => {
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
            purpose: 'user-input',
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
      'agent-loop-interaction',
    ])
    expect(
      rows[1]?.type === 'agent-loop-interaction' ? rows[1].item.resolution?.status : null,
    ).toBe('resolved')
  })

  it('drops info notifications from transcript rows but keeps warning notifications', () => {
    const rows = buildChatRows({
      messages: [],
      interactionEvents: [
        {
          type: 'agent_interaction_request',
          timestamp: 2,
          interaction: {
            interactionId: 'info-notify',
            sessionId: SessionId('session-1'),
            runId: 'run-1',
            kind: 'notify',
            source: 'pi-ui',
            createdAt: 2,
            message: 'Loaded',
            level: 'info',
          },
        },
        {
          type: 'agent_interaction_request',
          timestamp: 3,
          interaction: {
            interactionId: 'warning-notify',
            sessionId: SessionId('session-1'),
            runId: 'run-1',
            kind: 'notify',
            source: 'pi-ui',
            createdAt: 3,
            message: 'Needs attention',
            level: 'warning',
          },
        },
        {
          type: 'agent_interaction_resolved',
          timestamp: 4,
          runId: 'run-1',
          interactionId: 'warning-notify',
          kind: 'notify',
          status: 'resolved',
          response: { kind: 'notify', acknowledged: true },
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

    expect(rows.map((row) => row.type)).toEqual(['agent-loop-interaction'])
    expect(
      rows[0]?.type === 'agent-loop-interaction'
        ? rows[0].item.request.interaction.interactionId
        : null,
    ).toBe('warning-notify')
    expect(rows[0]?.type === 'agent-loop-interaction' ? rows[0].item.resolution : null).toBe(
      undefined,
    )
  })
})
