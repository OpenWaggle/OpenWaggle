import { copyFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { SessionId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearAgentLoopInteractionBrokerForTests,
  submitAgentLoopInteractionResponse,
} from '../../../application/agent-loop-interaction-broker'
import type { ActionRunServiceShape } from '../../../ports/action-run-service'
import { createProjectActionsToolExtension } from '../project-actions-tool-extension'
import {
  cleanupOpenWagglePiSessions,
  createOpenWagglePiSession,
} from './openwaggle-pi-session.test-support'
import { autoRouterExtension } from './virtual-model.test-support'

afterEach(cleanupOpenWagglePiSessions)

describe('codemode in an OpenWaggle Pi session', () => {
  it('is active in a fresh Session without MCP servers and can call the built-in tools', async () => {
    const { session } = await createOpenWagglePiSession()

    expect(session.getActiveToolNames()).toContain('codemode')
    expect(session.getActiveToolNames()).not.toContain('tool_search')
    expect(session.getCallableToolNames()).toEqual(
      expect.arrayContaining(['read', 'bash', 'edit', 'write']),
    )
  })

  it('is not offered when the user turns it off in OpenWaggle', async () => {
    const { session } = await createOpenWagglePiSession({
      appSettings: { codemodeEnabled: false, cacheWarming: 'streaming' },
    })

    expect(session.getActiveToolNames()).not.toContain('codemode')
    expect(session.getActiveToolNames()).toEqual(
      expect.arrayContaining(['read', 'bash', 'edit', 'write']),
    )
  })

  it("follows a Pi user's own choice to remove codemode until they choose in OpenWaggle", async () => {
    const { session } = await createOpenWagglePiSession({
      piGlobalSettings: { defaultTools: ['-codemode'] },
      openWaggleSettings: {},
    })

    expect(session.getActiveToolNames()).not.toContain('codemode')
  })

  it("keeps codemode on when the user turned it on in OpenWaggle, whatever Pi's settings say", async () => {
    const { session } = await createOpenWagglePiSession({
      piGlobalSettings: { defaultTools: ['-codemode'] },
      openWaggleSettings: { codemodeEnabled: true },
    })

    expect(session.getActiveToolNames()).toContain('codemode')
  })

  it('does not record OpenWaggle choices in the Pi settings file', async () => {
    const { agentDir, session } = await createOpenWagglePiSession({
      piGlobalSettings: { theme: 'dark' },
    })

    session.settingsManager.setTheme('light')
    await session.settingsManager.flush()

    expect(JSON.parse(readFileSync(path.join(agentDir, 'settings.json'), 'utf8'))).toEqual({
      theme: 'light',
    })
  })
})

function projectActionsStopTool(stoppedRunIds: string[]) {
  return createProjectActionsToolExtension({
    sessionId: SessionId('openwaggle-test-session'),
    runId: 'openwaggle-test-run',
    workspaces: {
      getBound: () =>
        Effect.succeed({
          id: 'workspace',
          projectPath: '/project',
          workingPath: '/project',
          kind: 'local',
          pending: false,
          worktreeBranch: null,
        }),
    },
    catalog: fromPartial({}),
    runs: fromPartial<ActionRunServiceShape>({
      stop: (_workspaceId: string, runId: string) => {
        stoppedRunIds.push(runId)
        return Effect.succeed(fromPartial({ id: runId }))
      },
    }),
  })
}

/** Records every `tool_call` hook Pi runs, as an extension would see them. */
function toolCallHookRecorder(calls: Array<{ toolName: string; parentToolCallId?: string }>) {
  return (pi: ExtensionAPI) => {
    pi.on('tool_call', (event) => {
      calls.push({
        toolName: event.toolName,
        ...(event.parentToolCallId ? { parentToolCallId: event.parentToolCallId } : {}),
      })
    })
  }
}

const STOP_TWO_ACTIONS = [
  "await tools.project_actions({ action: 'stop', runId: 'run-a' })",
  "await tools.project_actions({ action: 'stop', runId: 'run-b' })",
  "return 'stopped both'",
].join('\n')

function codemodeTurn(code: string) {
  return [
    fauxAssistantMessage(fauxToolCall('codemode', { code }, { id: 'script-1' }), {
      stopReason: 'toolUse',
    }),
    fauxAssistantMessage('done'),
  ]
}

function authorizationRequests(events: readonly AgentTransportEvent[]) {
  return events.flatMap((event) =>
    event.type === 'agent_interaction_request' &&
    event.interaction.kind === 'confirm' &&
    event.interaction.purpose === 'authorization'
      ? [event.interaction]
      : [],
  )
}

/** Answers each authorization request the way the user would, after it is pending. */
function answerAuthorizations(accepted: boolean) {
  return (event: AgentTransportEvent) => {
    if (event.type !== 'agent_interaction_request' || event.interaction.kind !== 'confirm') return
    const { interaction } = event
    setTimeout(() => {
      submitAgentLoopInteractionResponse({
        sessionId: interaction.sessionId,
        runId: interaction.runId,
        interactionId: interaction.interactionId,
        kind: 'confirm',
        response: { kind: 'confirm', accepted },
      })
    }, 0)
  }
}

describe('approval of codemode child calls', () => {
  afterEach(clearAgentLoopInteractionBrokerForTests)

  it('asks for approval once per child call in Ask for Approval mode', async () => {
    const stopped: string[] = []
    const hookCalls: Array<{ toolName: string; parentToolCallId?: string }> = []
    const { session, faux, events } = await createOpenWagglePiSession({
      authorizationMode: 'ask-for-approval',
      extensionFactories: [projectActionsStopTool(stopped), toolCallHookRecorder(hookCalls)],
      onEvent: answerAuthorizations(true),
    })
    faux.setResponses(codemodeTurn(STOP_TWO_ACTIONS))

    await session.prompt('Stop both actions')

    expect(authorizationRequests(events).map((request) => request.title)).toEqual([
      'Allow action stop?',
      'Allow action stop?',
    ])
    expect(stopped).toEqual(['run-a', 'run-b'])
    expect(hookCalls).toEqual([
      { toolName: 'codemode' },
      { toolName: 'project_actions', parentToolCallId: 'script-1' },
      { toolName: 'project_actions', parentToolCallId: 'script-1' },
    ])
  })

  it('runs a declined child call nowhere and tells the script', async () => {
    const stopped: string[] = []
    const { session, faux } = await createOpenWagglePiSession({
      authorizationMode: 'ask-for-approval',
      extensionFactories: [projectActionsStopTool(stopped)],
      onEvent: answerAuthorizations(false),
    })
    faux.setResponses(codemodeTurn(STOP_TWO_ACTIONS))

    await session.prompt('Stop both actions')

    expect(stopped).toEqual([])
    expect(JSON.stringify(session.messages)).toContain('The action was not authorized.')
  })

  it('allows every child call without asking in YOLO mode', async () => {
    const stopped: string[] = []
    const { session, faux, events } = await createOpenWagglePiSession({
      authorizationMode: 'yolo',
      extensionFactories: [projectActionsStopTool(stopped)],
    })
    faux.setResponses(codemodeTurn(STOP_TWO_ACTIONS))

    await session.prompt('Stop both actions')

    expect(authorizationRequests(events)).toEqual([])
    expect(stopped).toEqual(['run-a', 'run-b'])
  })
})

describe('codemode images', () => {
  it('shows an image file a script reads', async () => {
    const { session, faux, projectPath } = await createOpenWagglePiSession({
      extensionFactories: [autoRouterExtension('test-model')],
      selectedModel: { provider: 'router', id: 'auto' },
    })
    copyFileSync('build/icon-beta.png', path.join(projectPath, 'icon.png'))
    faux.setResponses(codemodeTurn("image(await tools.read({ path: 'icon.png' }))"))

    await session.prompt('Show the icon')

    const result = session.messages.find((message) => message.role === 'toolResult')
    expect(result?.isError).toBe(false)
    expect(result?.content).toContainEqual(
      expect.objectContaining({ type: 'image', mimeType: 'image/png' }),
    )
  })
})
