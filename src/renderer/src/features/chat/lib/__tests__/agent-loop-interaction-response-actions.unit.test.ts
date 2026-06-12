import { OPENWAGGLE_AGENT_LOOP } from '@shared/constants/agent-loop'
import { EXTENSION_FRAME_SURFACE_ACTION } from '@shared/constants/extension-frame'
import type { AgentLoopInteraction } from '@shared/types/agent-loop-interaction'
import { SessionId } from '@shared/types/brand'
import { describe, expect, it, vi } from 'vitest'
import { responseFromExtensionAction } from '../agent-loop-interaction-response-actions'

vi.mock('@/features/extensions', () => ({
  CUSTOM_INTERACTION_RESPONSE_ACTION_ID: 'custom-interaction-response',
  CUSTOM_INTERACTION_UNAVAILABLE_ACTION_ID: 'custom-renderer-unavailable',
}))

function customInteraction(): AgentLoopInteraction {
  return {
    interactionId: 'custom-interaction-1',
    sessionId: SessionId('session-1'),
    runId: 'run-1',
    kind: 'custom',
    customType: OPENWAGGLE_AGENT_LOOP.PI_TUI_CUSTOM_INTERACTION_TYPE,
    source: 'pi-ui',
    createdAt: 1,
    renderer: { kind: 'pi-tui-custom', supported: false },
  }
}

function confirmInteraction(): AgentLoopInteraction {
  return {
    interactionId: 'confirm-interaction-1',
    sessionId: SessionId('session-1'),
    runId: 'run-1',
    kind: 'confirm',
    source: 'pi-ui',
    createdAt: 1,
    title: 'Approve?',
    message: 'Allow the action?',
  }
}

describe('responseFromExtensionAction', () => {
  it('accepts typed custom desktop interaction responses from extension renderers', () => {
    const response = responseFromExtensionAction({
      interaction: customInteraction(),
      actionId: EXTENSION_FRAME_SURFACE_ACTION.CUSTOM_INTERACTION_RESPONSE,
      payload: {
        kind: 'custom',
        value: { approved: true, issueNumber: 113 },
      },
    })

    expect(response).toEqual({
      kind: 'custom',
      value: { approved: true, issueNumber: 113 },
    })
  })

  it('preserves raw custom renderer payloads for existing extension actions', () => {
    const response = responseFromExtensionAction({
      interaction: customInteraction(),
      actionId: EXTENSION_FRAME_SURFACE_ACTION.CUSTOM_INTERACTION_RESPONSE,
      payload: { approved: true, issueNumber: 113 },
    })

    expect(response).toEqual({
      kind: 'custom',
      value: { approved: true, issueNumber: 113 },
    })
  })

  it('rejects typed response envelopes for a different pending interaction kind', () => {
    const response = responseFromExtensionAction({
      interaction: confirmInteraction(),
      actionId: EXTENSION_FRAME_SURFACE_ACTION.CUSTOM_INTERACTION_RESPONSE,
      payload: { kind: 'custom', value: { approved: true } },
    })

    expect(response).toBeNull()
  })
})
