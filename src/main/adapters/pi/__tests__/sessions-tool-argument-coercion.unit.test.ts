import { validateToolArguments } from '@earendil-works/pi-ai'
import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it } from 'vitest'
import { installSessionToolGateway } from '../../../session-host/session-tool-gateway'
import { createSessionsToolExtension } from '../sessions-tool-extension'

function registeredTool() {
  let tool: ToolDefinition | undefined
  createSessionsToolExtension({
    sessionId: 'session-queen',
    runId: 'run-current',
    workingDirectory: '/repo',
    projectPath: '/repo',
  })(
    fromPartial<ExtensionAPI>({
      registerTool: (registered: ToolDefinition) => {
        tool = registered
      },
    }),
  )
  if (!tool) throw new Error('The hive tool was not registered.')
  return tool
}

/** A model's tool call as Pi handles it: prepare, validate against the declared schema, run. */
async function callAsPi(tool: ToolDefinition, args: Record<string, string | null>) {
  tool.prepareArguments?.(args)
  const validated: unknown = validateToolArguments(
    { name: tool.name, description: tool.description, parameters: tool.parameters },
    { type: 'toolCall', id: 'call-1', name: tool.name, arguments: args },
  )
  return tool.execute('call-1', validated, undefined, () => undefined, fromPartial({}))
}

describe('hive arguments of rarer actions', () => {
  let releaseGateway: (() => void) | undefined

  afterEach(() => {
    releaseGateway?.()
    releaseGateway = undefined
  })

  it('coerces strings and drops optional nulls the declared schema does not type', async () => {
    const payloads: LocalSessionCommandPayload[] = []
    releaseGateway = installSessionToolGateway(async (input) => {
      payloads.push(input.payload)
      return fromPartial({})
    })
    const tool = registeredTool()

    const results = [
      await callAsPi(tool, { action: 'list', limit: '20', cursor: null }),
      await callAsPi(tool, { action: 'queue_list', sessionId: 'session-a', includeBodies: 'true' }),
      await callAsPi(tool, { action: 'turns', sessionId: 'session-a', limit: '5', cursor: null }),
      await callAsPi(tool, {
        action: 'items',
        sessionId: 'session-a',
        limit: '5',
        afterCreatedOrder: '3',
        snapshotHeadNodeId: null,
      }),
    ]

    for (const result of results) expect(result).not.toMatchObject({ isError: true })
    expect(payloads).toHaveLength(4)
    expect(payloads[0]).toMatchObject({ request: { query: { operation: 'list', limit: 20 } } })
    expect(JSON.stringify(payloads[0])).not.toContain('cursor')
    expect(payloads[1]).toMatchObject({
      request: { query: { operation: 'queue-list', sessionId: 'session-a', includeBodies: true } },
    })
    expect(payloads[2]).toMatchObject({ request: { query: { operation: 'turns', limit: 5 } } })
    expect(payloads[3]).toMatchObject({
      request: { query: { operation: 'items', limit: 5, afterCreatedOrder: 3 } },
    })
    expect(JSON.stringify(payloads)).not.toContain('null')
  })

  it('still refuses a value no coercion makes valid', async () => {
    releaseGateway = installSessionToolGateway(async () => fromPartial({}))

    const result = await callAsPi(registeredTool(), { action: 'list', limit: 'twenty' })

    expect(result).toMatchObject({ isError: true })
    expect(JSON.stringify(result.content)).toContain('/limit')
  })
})
