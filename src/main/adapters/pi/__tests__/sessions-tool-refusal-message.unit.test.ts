import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LocalSessionCommandAuthorizationError,
  SessionLifecyclePreparationError,
} from '../../../errors'
import { installSessionToolGateway } from '../../../session-host/session-tool-gateway'
import { createSessionsToolExtension } from '../sessions-tool-extension'

function registeredTool() {
  let tool: ToolDefinition | undefined
  createSessionsToolExtension({
    sessionId: 'session-gosafe',
    runId: 'run-current',
    workingDirectory: '/projects/gosafe',
    projectPath: '/projects/gosafe',
  })(
    fromPartial<ExtensionAPI>({
      registerTool: (registered: ToolDefinition) => {
        tool = registered
      },
    }),
  )
  if (!tool) throw new Error('The sessions tool was not registered.')
  return tool
}

describe('Sessions tool refusal messages', () => {
  let releaseGateway: (() => void) | undefined

  afterEach(() => {
    releaseGateway?.()
    releaseGateway = undefined
  })

  it('reports why the Host refused instead of Effect placeholder text', async () => {
    // The real gateway runs the Host command with Effect.runPromise, which wraps a tagged
    // failure without a message field as "An error has occurred".
    releaseGateway = installSessionToolGateway(() =>
      Effect.runPromise(
        Effect.fail(
          new LocalSessionCommandAuthorizationError({
            code: 'capability_denied',
            missing: ['sessions:create'],
          }),
        ),
      ),
    )
    const result = await registeredTool().execute(
      'tool-call',
      {
        action: 'launch',
        projectPath: '/projects/openwaggle',
        objective: 'Fix the bug.',
        workspace: 'new-worktree',
      },
      undefined,
      () => undefined,
      fromPartial({}),
    )

    expect(result).toMatchObject({ isError: true })
    const [content] = result.content
    const text = content?.type === 'text' ? content.text : ''
    expect(text).not.toContain('An error has occurred')
    expect(text).toBe(
      'Session command refused (capability_denied): the caller lacks a Session capability this operation requires. Missing capabilities: sessions:create.',
    )
  })

  it('names the failed Host operation and its cause for other tagged failures', async () => {
    releaseGateway = installSessionToolGateway(() =>
      Effect.runPromise(
        Effect.fail(
          new SessionLifecyclePreparationError({
            operation: 'prepare-session-lifecycle',
            cause: new Error('Project directory does not exist: /projects/missing'),
          }),
        ),
      ),
    )
    const result = await registeredTool().execute(
      'tool-call',
      { action: 'create', projectPath: '/projects/missing' },
      undefined,
      () => undefined,
      fromPartial({}),
    )

    const [content] = result.content
    expect(content?.type === 'text' ? content.text : '').toBe(
      'SessionLifecyclePreparationError (prepare-session-lifecycle): Project directory does not exist: /projects/missing',
    )
  })
})
