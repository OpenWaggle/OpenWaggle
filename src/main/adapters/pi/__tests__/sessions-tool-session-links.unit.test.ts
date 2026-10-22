import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalSessionCommandAuthorizationError } from '../../../errors'
import { installSessionToolGateway } from '../../../session-host/session-tool-gateway'
import { createSessionsToolExtension } from '../sessions-tool-extension'
import { resolveSessionsToolSessionLinks } from '../sessions-tool-session-links'

const SESSION_ID = '4bc96a8e-3b0a-456f-8ac3-64b8be7dc940'
const LINK = `openwaggle://sessions/${SESSION_ID}`

function registeredTool() {
  let tool: ToolDefinition | undefined
  createSessionsToolExtension({
    sessionId: 'session-caller',
    runId: 'run-current',
    workingDirectory: '/projects/one',
    projectPath: '/projects/one',
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

async function runTool(params: Record<string, unknown>) {
  const result = await registeredTool().execute(
    'tool-call',
    params,
    undefined,
    () => undefined,
    fromPartial({}),
  )
  const [content] = result.content
  return { result, text: content?.type === 'text' ? content.text : '' }
}

describe('Session links in the Sessions tool', () => {
  let releaseGateway: (() => void) | undefined

  afterEach(() => {
    releaseGateway?.()
    releaseGateway = undefined
  })

  it('sends the Host the same command for a Session link as for its bare identity', async () => {
    const payloads: LocalSessionCommandPayload[] = []
    releaseGateway = installSessionToolGateway(async (input) => {
      payloads.push(input.payload)
      return fromPartial({})
    })

    await runTool({ action: 'read', sessionId: SESSION_ID })
    await runTool({ action: 'read', sessionId: LINK })

    expect(payloads).toHaveLength(2)
    const expected = {
      contract: 'session-query-v2',
      request: { query: { operation: 'read', sessionId: SESSION_ID } },
    }
    expect(payloads[0]).toMatchObject(expected)
    expect(payloads[1]).toMatchObject(expected)
  })

  it('gets the same scope refusal through a link as through the identity', async () => {
    releaseGateway = installSessionToolGateway(() =>
      Effect.runPromise(
        Effect.fail(new LocalSessionCommandAuthorizationError({ code: 'target_scope_denied' })),
      ),
    )

    const byId = await runTool({ action: 'read', sessionId: SESSION_ID })
    const byLink = await runTool({ action: 'read', sessionId: LINK })

    expect(byLink.result).toMatchObject({ isError: true })
    expect(byLink.text).toBe(byId.text)
    expect(byLink.text).toContain('target_scope_denied')
  })

  it('refuses an openwaggle URL that is not a Session link before reaching the Host', async () => {
    const gateway = vi.fn(async () => fromPartial({}))
    releaseGateway = installSessionToolGateway(gateway)

    const { result, text } = await runTool({
      action: 'read',
      sessionId: 'openwaggle://app/index.html',
    })

    expect(result).toMatchObject({ isError: true })
    expect(text).toContain('sessionId is not a Session link')
    expect(gateway).not.toHaveBeenCalled()
  })

  it('tells the agent that pasted Session links work as identities', async () => {
    const registerTool = vi.fn()
    await createSessionsToolExtension({
      sessionId: 'session-caller',
      runId: 'run-current',
      workingDirectory: '/project',
    })(fromPartial<ExtensionAPI>({ registerTool }))

    const guidelines: unknown = registerTool.mock.calls[0]?.[0]?.promptGuidelines
    expect(guidelines).toEqual(
      expect.arrayContaining([expect.stringContaining('openwaggle://sessions/<session-id>')]),
    )
  })
})

describe('resolveSessionsToolSessionLinks', () => {
  it('resolves every Session identity field', () => {
    expect(
      resolveSessionsToolSessionLinks({
        action: 'wait',
        sessionIds: [LINK, 'other'],
        timeoutMs: 0,
      }),
    ).toEqual({ action: 'wait', sessionIds: [SESSION_ID, 'other'], timeoutMs: 0 })
    expect(
      resolveSessionsToolSessionLinks({
        action: 'wait',
        sessionIds: [LINK, SESSION_ID],
        timeoutMs: 0,
      }),
    ).toEqual({ action: 'wait', sessionIds: [SESSION_ID], timeoutMs: 0 })
    expect(
      resolveSessionsToolSessionLinks({
        action: 'delegations_list',
        parentSessionId: LINK,
        workerSessionId: LINK,
      }),
    ).toEqual({
      action: 'delegations_list',
      parentSessionId: SESSION_ID,
      workerSessionId: SESSION_ID,
    })
    expect(
      resolveSessionsToolSessionLinks({
        action: 'report',
        text: 'Context.',
        target: { type: 'session', sessionId: LINK },
      }),
    ).toMatchObject({ target: { type: 'session', sessionId: SESSION_ID } })
    expect(
      resolveSessionsToolSessionLinks({
        action: 'report',
        text: 'Context.',
        target: { type: 'sessions', sessionIds: [LINK] },
      }),
    ).toMatchObject({ target: { type: 'sessions', sessionIds: [SESSION_ID] } })
  })

  it('resolves a Worker reference given as a Session link and keeps names as they are', () => {
    expect(
      resolveSessionsToolSessionLinks({
        action: 'report',
        text: 'Context.',
        target: { type: 'worker_reference', reference: LINK },
      }),
    ).toMatchObject({ target: { type: 'worker_reference', reference: SESSION_ID } })
  })

  it('leaves parameters without Session links unchanged', () => {
    const params = {
      action: 'report',
      text: 'Context.',
      target: { type: 'worker_reference', reference: 'reviewer' },
    } as const
    expect(resolveSessionsToolSessionLinks(params)).toEqual(params)
    expect(resolveSessionsToolSessionLinks({ action: 'fork' })).toEqual({ action: 'fork' })
  })
})
