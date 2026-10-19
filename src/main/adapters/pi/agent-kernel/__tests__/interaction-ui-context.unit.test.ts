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
import { getOpenWaggleAuthorize } from '../openwaggle-authorize-channel'

const sessionId = SessionId('pi-ui-session')

/**
 * Waits for the microtasks `confirm` spends resolving the authorization mode.
 *
 * The mode is read when the request is raised rather than captured per run, so a confirm cannot
 * emit its request event synchronously: it has to know first whether full access would grant it
 * outright, since an auto-granted call must leave no transcript entry at all.
 */
async function flushAuthorizationResolution() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function createContext(input?: {
  readonly signal?: AbortSignal
  readonly authorizationMode?: AgentAuthorizationMode
}) {
  const emitted: AgentTransportEvent[] = []
  const ui = createPiInteractionUiContext(
    {
      sessionId,
      runId: 'run-pi-ui',
      authorizationProjectPath: null,
      resolveAuthorizationMode: async () => input?.authorizationMode ?? 'yolo',
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
    await flushAuthorizationResolution()
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

  it('never auto-accepts a plain confirm, even in full access', async () => {
    // Plain confirm is a question addressed to the user. Purpose used to be guessed from the title,
    // so this exact call was auto-granted in full access; now only the declared authorization
    // channel can be.
    const { emitted, ui } = createContext({ authorizationMode: 'yolo' })

    const confirmed = ui.confirm('Allow MCP tool call?', 'Read project files?')
    await flushAuthorizationResolution()

    expect(emitted).toMatchObject([
      {
        type: 'agent_interaction_request',
        interaction: { kind: 'confirm', purpose: 'user-input' },
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

  it('exposes the authorization channel, which full access grants without emitting anything', async () => {
    const { emitted, ui } = createContext({ authorizationMode: 'yolo' })
    const authorize = getOpenWaggleAuthorize(ui)
    if (!authorize) throw new Error('Expected the OpenWaggle authorization channel')

    await expect(
      authorize({
        title: 'Allow MCP tool call?',
        message: 'Read project files?',
        scopeKey: {
          requester: 'github-issues',
          requesterId: 'github-issues-id',
          capability: 'mcp.tool-call',
          resource: 'list_issues',
        },
      }),
    ).resolves.toBe(true)
    expect(emitted).toEqual([])
  })

  it('asks through the authorization channel in approval mode', async () => {
    const { emitted, ui } = createContext({ authorizationMode: 'ask-for-approval' })
    const authorize = getOpenWaggleAuthorize(ui)
    if (!authorize) throw new Error('Expected the OpenWaggle authorization channel')

    const confirmed = authorize({
      title: 'Allow MCP tool call?',
      message: 'Read project files?',
      scopeKey: {
        requester: 'github-issues',
        requesterId: 'github-issues-id',
        capability: 'mcp.tool-call',
        resource: 'list_issues',
      },
    })
    await flushAuthorizationResolution()

    expect(emitted).toMatchObject([
      {
        type: 'agent_interaction_request',
        interaction: {
          kind: 'confirm',
          title: 'Allow MCP tool call?',
          purpose: 'authorization',
          scopeKey: { capability: 'mcp.tool-call', resource: 'list_issues' },
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

  // Pi's footer status was dropped, so an extension's slow agent_before_settle check said nothing.
  it('emits extension status per key, and clears it with undefined', () => {
    const { emitted, ui } = createContext()

    ui.setStatus('club-hooks', 'TypeScript hooks: lint, type-check, tests')
    ui.setStatus('club-hooks', undefined)

    expect(emitted).toMatchObject([
      {
        type: 'extension_status',
        runId: 'run-pi-ui',
        slot: { kind: 'status', key: 'club-hooks' },
        text: 'TypeScript hooks: lint, type-check, tests',
      },
      { type: 'extension_status', slot: { kind: 'status', key: 'club-hooks' } },
    ])
    expect(emitted[1]).not.toHaveProperty('text')
  })

  it('sends extension status as one plain line, since Pi TUI styles it with ANSI colors', () => {
    const { emitted, ui } = createContext()

    ui.setStatus('x', '\u001b[33mbusy\u001b[39m\n  checking')
    ui.setStatus('y', '  \u001b[2m\u001b[22m ')

    expect(emitted).toMatchObject([
      { slot: { key: 'x' }, text: 'busy checking' },
      { slot: { key: 'y' } },
    ])
    // Blank text clears, as Pi's footer drops it.
    expect(emitted[1]).not.toHaveProperty('text')
  })

  it('emits the working message, and restores the default without one', () => {
    const { emitted, ui } = createContext()

    ui.setWorkingMessage('Running checks')
    ui.setWorkingMessage()

    expect(emitted).toMatchObject([
      { type: 'extension_status', slot: { kind: 'working-message' }, text: 'Running checks' },
      { type: 'extension_status', slot: { kind: 'working-message' } },
    ])
    expect(emitted[1]).not.toHaveProperty('text')
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
    await flushAuthorizationResolution()
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
