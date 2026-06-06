import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent'
import { SessionId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearAgentLoopInteractionBrokerForTests,
  submitAgentLoopInteractionResponse,
} from '../../../../application/agent-loop-interaction-broker'
import { createPiInteractionUiContext } from '../interaction-ui-context'

const sessionId = SessionId('pi-ui-session')

function createContext() {
  const emitted: AgentTransportEvent[] = []
  const ui = createPiInteractionUiContext(
    {
      sessionId,
      runId: 'run-pi-ui',
      signal: new AbortController().signal,
      onEvent: (event) => emitted.push(event),
    },
    fromPartial<ExtensionUIContext>({}),
  )
  return { emitted, ui }
}

describe('Pi interaction UI context', () => {
  beforeEach(() => {
    clearAgentLoopInteractionBrokerForTests()
  })

  it('bridges Pi confirm to a typed OpenWaggle interaction response', async () => {
    const { emitted, ui } = createContext()
    const confirmed = ui.confirm('Proceed?', 'Run the extension tool?')
    const request = emitted[0]

    expect(request).toMatchObject({
      type: 'agent_interaction_request',
      interaction: { kind: 'confirm', title: 'Proceed?', message: 'Run the extension tool?' },
    })
    if (request?.type !== 'agent_interaction_request') {
      throw new Error('Expected pending interaction request')
    }

    submitAgentLoopInteractionResponse({
      sessionId,
      runId: 'run-pi-ui',
      interactionId: request.interaction.interactionId,
      kind: 'confirm',
      response: { kind: 'confirm', accepted: true },
    })

    await expect(confirmed).resolves.toBe(true)
  })

  it('emits Pi notify as an immediately resolved interaction', () => {
    const { emitted, ui } = createContext()

    ui.notify('Extension loaded', 'info')

    expect(emitted).toMatchObject([
      { type: 'agent_interaction_request', interaction: { kind: 'notify' } },
      { type: 'agent_interaction_resolved', kind: 'notify', status: 'resolved' },
    ])
  })

  it('fails custom TUI interactions explicitly in Electron', async () => {
    const { emitted, ui } = createContext()

    await expect(ui.custom(() => fromPartial({}))).rejects.toThrow(
      'Pi custom TUI interactions are not supported',
    )
    expect(emitted).toHaveLength(2)
    const request = emitted[0]
    const resolved = emitted[1]
    expect(request).toMatchObject({
      type: 'agent_interaction_request',
      interaction: {
        sessionId,
        runId: 'run-pi-ui',
        kind: 'custom',
        source: 'pi-ui',
        renderer: { kind: 'pi-tui-custom', supported: false },
      },
    })
    if (request?.type !== 'agent_interaction_request') {
      throw new Error('Expected pending custom interaction request')
    }
    expect(resolved).toMatchObject({
      type: 'agent_interaction_resolved',
      runId: 'run-pi-ui',
      interactionId: request.interaction.interactionId,
      kind: 'custom',
      status: 'errored',
      error: { code: 'custom-renderer-unavailable' },
    })
  })
})
