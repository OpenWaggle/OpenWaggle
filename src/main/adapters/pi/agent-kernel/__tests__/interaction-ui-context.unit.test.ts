import { getEventListeners } from 'node:events'
import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent'
import { OPENWAGGLE_AGENT_LOOP } from '@shared/constants/agent-loop'
import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
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

function createContext(input?: {
  readonly signal?: AbortSignal
  readonly authorizationMode?: AgentAuthorizationMode
}) {
  const emitted: AgentTransportEvent[] = []
  const ui = createPiInteractionUiContext(
    {
      sessionId,
      runId: 'run-pi-ui',
      authorizationMode: input?.authorizationMode ?? 'yolo',
      signal: input?.signal ?? new AbortController().signal,
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

  it('auto-accepts authorization confirmations in YOLO mode without emitting audit events', async () => {
    const { emitted, ui } = createContext({ authorizationMode: 'yolo' })

    await expect(ui.confirm('Allow MCP tool call?', 'Read project files?')).resolves.toBe(true)
    expect(emitted).toEqual([])
  })

  it('asks authorization confirmations in approval mode', async () => {
    const { emitted, ui } = createContext({ authorizationMode: 'ask-for-approval' })

    const confirmed = ui.confirm('Allow MCP tool call?', 'Read project files?')

    expect(emitted).toMatchObject([
      {
        type: 'agent_interaction_request',
        interaction: {
          kind: 'confirm',
          title: 'Allow MCP tool call?',
          message: 'Read project files?',
          purpose: 'authorization',
        },
      },
    ])
    const request = emitted[0]
    if (request?.type !== 'agent_interaction_request') {
      throw new Error('Expected pending interaction request')
    }

    submitAgentLoopInteractionResponse({
      sessionId,
      runId: 'run-pi-ui',
      interactionId: request.interaction.interactionId,
      kind: 'confirm',
      response: { kind: 'confirm', accepted: false },
    })

    await expect(confirmed).resolves.toBe(false)
  })

  it('emits Pi notify as an immediately resolved interaction', () => {
    const { emitted, ui } = createContext()

    ui.notify('Extension loaded', 'info')

    expect(emitted).toMatchObject([
      { type: 'agent_interaction_request', interaction: { kind: 'notify' } },
      { type: 'agent_interaction_resolved', kind: 'notify', status: 'resolved' },
    ])
  })

  it('bridges Pi custom interactions to pending OpenWaggle desktop interactions', async () => {
    const { emitted, ui } = createContext()

    const customResult = ui.custom(() => fromPartial({}))
    expect(emitted).toHaveLength(1)
    const request = emitted[0]
    expect(request).toMatchObject({
      type: 'agent_interaction_request',
      interaction: {
        sessionId,
        runId: 'run-pi-ui',
        kind: 'custom',
        customType: OPENWAGGLE_AGENT_LOOP.PI_TUI_CUSTOM_INTERACTION_TYPE,
        source: 'pi-ui',
        renderer: { kind: 'pi-tui-custom', supported: false },
      },
    })
    if (request?.type !== 'agent_interaction_request') {
      throw new Error('Expected pending custom interaction request')
    }

    submitAgentLoopInteractionResponse({
      sessionId,
      runId: 'run-pi-ui',
      interactionId: request.interaction.interactionId,
      kind: 'custom',
      response: { kind: 'custom', value: { approved: true } },
    })

    await expect(customResult).resolves.toEqual({ approved: true })
    expect(emitted[1]).toMatchObject({
      type: 'agent_interaction_resolved',
      kind: 'custom',
      status: 'resolved',
      response: { kind: 'custom', value: { approved: true } },
    })
  })

  it('releases parent abort listeners after an interaction settles', async () => {
    const runController = new AbortController()
    const interactionController = new AbortController()
    const { emitted, ui } = createContext({ signal: runController.signal })

    const confirmed = ui.confirm('Proceed?', 'Run the extension tool?', {
      signal: interactionController.signal,
    })
    const request = emitted[0]
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
    expect(getEventListeners(runController.signal, 'abort')).toHaveLength(0)
    expect(getEventListeners(interactionController.signal, 'abort')).toHaveLength(0)
  })
})
