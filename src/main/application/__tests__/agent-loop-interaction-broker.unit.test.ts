import { OPENWAGGLE_AGENT_LOOP } from '@shared/constants/agent-loop'
import { SessionId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearAgentLoopInteractionBrokerForTests,
  failAgentLoopInteraction,
  requestAgentLoopInteraction,
  submitAgentLoopInteractionResponse,
} from '../agent-loop-interaction-broker'

const sessionId = SessionId('interaction-session')

function confirmInteraction() {
  return {
    interactionId: 'confirm-1',
    sessionId,
    runId: 'run-1',
    kind: 'confirm',
    source: 'pi-ui',
    createdAt: 1,
    title: 'Continue?',
    message: 'Allow Pi to proceed?',
  } as const
}

function selectInteraction() {
  return {
    interactionId: 'select-1',
    sessionId,
    runId: 'run-1',
    kind: 'select',
    source: 'pi-ui',
    createdAt: 1,
    title: 'Pick mode',
    choices: ['safe', 'fast'],
  } as const
}

function customInteraction() {
  return {
    interactionId: 'custom-1',
    sessionId,
    runId: 'run-1',
    kind: 'custom',
    customType: OPENWAGGLE_AGENT_LOOP.PI_TUI_CUSTOM_INTERACTION_TYPE,
    source: 'pi-ui',
    createdAt: 1,
    renderer: { kind: 'pi-tui-custom', supported: false },
  } as const
}

describe('agent-loop interaction broker', () => {
  beforeEach(() => {
    clearAgentLoopInteractionBrokerForTests()
  })

  it('emits pending and resolved events while resolving Pi confirm responses', async () => {
    const emitted: AgentTransportEvent[] = []
    const pending = requestAgentLoopInteraction({
      interaction: confirmInteraction(),
      onEvent: (event) => emitted.push(event),
    })

    const submit = submitAgentLoopInteractionResponse({
      sessionId,
      runId: 'run-1',
      interactionId: 'confirm-1',
      kind: 'confirm',
      response: { kind: 'confirm', accepted: true },
    })

    await expect(pending).resolves.toEqual({ kind: 'confirm', accepted: true })
    expect(submit).toEqual({ ok: true, interactionId: 'confirm-1', status: 'resolved' })
    expect(emitted).toMatchObject([
      { type: 'agent_interaction_request', interaction: { kind: 'confirm' } },
      {
        type: 'agent_interaction_resolved',
        interactionId: 'confirm-1',
        kind: 'confirm',
        status: 'resolved',
      },
    ])
  })

  it('keeps a select pending when the response payload is invalid', async () => {
    const emitted: AgentTransportEvent[] = []
    const pending = requestAgentLoopInteraction({
      interaction: selectInteraction(),
      onEvent: (event) => emitted.push(event),
    })

    const invalid = submitAgentLoopInteractionResponse({
      sessionId,
      runId: 'run-1',
      interactionId: 'select-1',
      kind: 'select',
      response: { kind: 'select', selected: 'unsafe' },
    })
    const valid = submitAgentLoopInteractionResponse({
      sessionId,
      runId: 'run-1',
      interactionId: 'select-1',
      kind: 'select',
      response: { kind: 'select', selected: 'safe' },
    })

    await expect(pending).resolves.toEqual({ kind: 'select', selected: 'safe' })
    expect(invalid).toMatchObject({
      ok: false,
      error: { code: 'invalid-response-payload' },
    })
    expect(valid).toEqual({ ok: true, interactionId: 'select-1', status: 'resolved' })
    expect(emitted.filter((event) => event.type === 'agent_interaction_resolved')).toHaveLength(1)
  })

  it('resolves with the Pi dismissed fallback when the run aborts', async () => {
    const emitted: AgentTransportEvent[] = []
    const abortController = new AbortController()
    const pending = requestAgentLoopInteraction({
      interaction: selectInteraction(),
      onEvent: (event) => emitted.push(event),
      signal: abortController.signal,
    })

    abortController.abort()

    await expect(pending).resolves.toEqual({ kind: 'select', selected: null })
    expect(emitted).toMatchObject([
      { type: 'agent_interaction_request' },
      { type: 'agent_interaction_resolved', status: 'cancelled' },
    ])
  })

  it('emits an explicit failure for unsupported Pi custom interactions', () => {
    const emitted: AgentTransportEvent[] = []

    failAgentLoopInteraction({
      interaction: customInteraction(),
      onEvent: (event) => emitted.push(event),
      error: {
        code: 'custom-renderer-unavailable',
        message: 'No desktop renderer is registered.',
      },
    })

    expect(emitted).toMatchObject([
      {
        type: 'agent_interaction_request',
        interaction: {
          interactionId: 'custom-1',
          sessionId,
          runId: 'run-1',
          kind: 'custom',
          customType: OPENWAGGLE_AGENT_LOOP.PI_TUI_CUSTOM_INTERACTION_TYPE,
          source: 'pi-ui',
          renderer: { kind: 'pi-tui-custom', supported: false },
        },
      },
      {
        type: 'agent_interaction_resolved',
        runId: 'run-1',
        interactionId: 'custom-1',
        kind: 'custom',
        status: 'errored',
        error: { code: 'custom-renderer-unavailable' },
      },
    ])
  })
})
