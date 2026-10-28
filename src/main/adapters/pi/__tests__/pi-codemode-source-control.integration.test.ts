import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai'
import { SessionId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearAgentLoopInteractionBrokerForTests,
  submitAgentLoopInteractionResponse,
} from '../../../application/agent-loop-interaction-broker'
import {
  createAgentRunContextExtension,
  createAgentToolAllowlistGuard,
} from '../agent-run-context-extension'
import { createSourceControlToolExtension } from '../source-control-tool-extension'
import {
  cleanupOpenWagglePiSessions,
  createOpenWagglePiSession,
} from './openwaggle-pi-session.test-support'
import {
  PROJECT_ROOT,
  sourceControlToolHarness,
  WORKING_PATH,
} from './source-control-tool.test-harness'

/*
 * A Run adds OpenWaggle's source_control tool next to codemode, which is on by default, so a
 * script can call it as a nested call: it must work there, with its authorization prompt, and the
 * Agent definition's allowlist must govern it like any tool.
 */

afterEach(cleanupOpenWagglePiSessions)
afterEach(clearAgentLoopInteractionBrokerForTests)

function sourceControlTool() {
  const { backend } = sourceControlToolHarness()
  const extension = createSourceControlToolExtension({
    sessionId: SessionId('openwaggle-test-session'),
    workspaces: {
      getBound: () =>
        Effect.succeed({
          id: 'workspace-1',
          projectPath: PROJECT_ROOT,
          workingPath: WORKING_PATH,
          kind: 'managed-worktree',
          pending: false,
          worktreeBranch: 'feature',
        }),
    },
    backend,
  })
  return { backend, extension }
}

function codemodeTurn(code: string) {
  return [
    fauxAssistantMessage(fauxToolCall('codemode', { code }, { id: 'script-1' }), {
      stopReason: 'toolUse',
    }),
    fauxAssistantMessage('done'),
  ]
}

/** What the codemode script's result message says. */
function scriptResult(messages: readonly unknown[]) {
  return JSON.stringify(
    messages.filter(
      (message) =>
        typeof message === 'object' &&
        message !== null &&
        'role' in message &&
        message.role === 'toolResult',
    ),
  )
}

function approveAuthorizations(event: AgentTransportEvent) {
  if (event.type !== 'agent_interaction_request' || event.interaction.kind !== 'confirm') return
  const { interaction } = event
  setTimeout(() => {
    submitAgentLoopInteractionResponse({
      sessionId: interaction.sessionId,
      runId: interaction.runId,
      interactionId: interaction.interactionId,
      kind: 'confirm',
      response: { kind: 'confirm', accepted: true },
    })
  }, 0)
}

describe('the source_control tool under codemode', () => {
  it('is callable from a codemode script, which reads its status', async () => {
    const { backend, extension } = sourceControlTool()
    const { session, faux } = await createOpenWagglePiSession({ extensionFactories: [extension] })
    expect(session.getCallableToolNames()).toContain('source_control')
    faux.setResponses(codemodeTurn("return await tools.source_control({ action: 'status' })"))

    await session.prompt('Why does View PR not work?')

    expect(backend.openWorkingTree).toHaveBeenCalled()
    expect(scriptResult(session.messages)).toContain('git.acme.io')
  })

  it('asks for authorization before a script applies a change', async () => {
    const { backend, extension } = sourceControlTool()
    const { session, faux, events } = await createOpenWagglePiSession({
      authorizationMode: 'ask-for-approval',
      extensionFactories: [extension],
      onEvent: approveAuthorizations,
    })
    faux.setResponses(
      codemodeTurn(
        "return await tools.source_control({ action: 'configure', change: 'set-host-provider', host: 'git.acme.io', provider: 'gitlab' })",
      ),
    )

    await session.prompt('git.acme.io is our GitLab')

    expect(
      events.some(
        (event) =>
          event.type === 'agent_interaction_request' &&
          event.interaction.kind === 'confirm' &&
          event.interaction.title === 'Allow source control change?',
      ),
    ).toBe(true)
    expect(backend.configure).toHaveBeenCalledWith(
      { kind: 'set-host-provider', host: 'git.acme.io', provider: 'gitlab' },
      expect.anything(),
    )
  })

  it("is refused to a script when the Agent definition's allowlist leaves it out", async () => {
    const { backend, extension } = sourceControlTool()
    const guard = createAgentToolAllowlistGuard({ toolAllowlist: ['read', 'codemode'] })
    if (!guard) throw new Error('expected an allowlist guard')
    const { session, faux } = await createOpenWagglePiSession({
      extensionFactories: [guard, extension],
    })
    faux.setResponses(codemodeTurn("return await tools.source_control({ action: 'status' })"))

    await session.prompt('Check source control')

    expect(backend.openWorkingTree).not.toHaveBeenCalled()
    expect(scriptResult(session.messages)).toContain('does not allow the tool source_control')
  })

  it('is declared and callable when the Agent definition names it, without tool_search', async () => {
    const { backend, extension } = sourceControlTool()
    const allowlist = { toolAllowlist: ['read', 'source_control'] }
    const guard = createAgentToolAllowlistGuard(allowlist)
    if (!guard) throw new Error('expected an allowlist guard')
    const { session, faux } = await createOpenWagglePiSession({
      extensionFactories: [
        guard,
        extension,
        createAgentRunContextExtension({ sessionIdentityContext: '- Session ID: s', ...allowlist }),
      ],
    })
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall('source_control', { action: 'status' }, { id: 'direct-1' }),
          fauxToolCall('bash', { command: 'echo refused' }, { id: 'direct-2' }),
        ],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('done'),
    ])

    await session.prompt('Why does View PR not work?')

    expect(session.getActiveToolNames()).toEqual(['read', 'source_control'])
    expect(backend.openWorkingTree).toHaveBeenCalled()
    expect(scriptResult(session.messages)).toContain('git.acme.io')
    // A tool outside the allowlist is still neither declared nor run.
    expect(scriptResult(session.messages)).toMatch(/"toolName":"bash".*"isError":true/)
  })
})
