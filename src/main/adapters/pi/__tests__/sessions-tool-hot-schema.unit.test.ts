import { validateToolArguments } from '@earendil-works/pi-ai'
import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { SessionCapability } from '@shared/types/session-capability'
import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { createSessionsToolExtension } from '../sessions-tool-extension'
import { hiveHelpText } from './hive-help.test-utils'

const WORKER_CAPABILITIES: readonly SessionCapability[] = [
  'sessions:discover',
  'sessions:read',
  'sessions:spawn',
  'sessions:message',
  'sessions:steer',
  'sessions:interrupt',
  'sessions:queue',
  'sessions:report',
  'delegations:read',
  'delegations:contribute',
  'delegations:review',
]

function register(capabilities?: readonly SessionCapability[]) {
  let tool: ToolDefinition | undefined
  createSessionsToolExtension({
    sessionId: 'session-queen',
    runId: 'run-current',
    workingDirectory: '/repo',
    projectPath: '/repo',
    ...(capabilities ? { sessionCapabilities: capabilities } : {}),
  })(
    fromPartial<ExtensionAPI>({
      registerTool: (registered: ToolDefinition) => {
        tool = registered
      },
    }),
  )
  if (!tool) throw new Error('hive tool was not registered')
  return tool
}

function schemaOf(tool: ToolDefinition) {
  return fromAny<
    { properties: Record<string, { enum?: unknown[]; anyOf?: unknown[]; type?: unknown }> },
    unknown
  >(JSON.parse(JSON.stringify(tool.parameters)))
}

/** What Pi does with a model's tool call before the tool runs. */
function piValidates(tool: ToolDefinition, args: Record<string, string>) {
  return validateToolArguments(
    { name: tool.name, description: tool.description, parameters: tool.parameters },
    { type: 'toolCall', id: 'call-1', name: tool.name, arguments: args },
  )
}

describe('hive two-tier schema', () => {
  it('names every permitted action and help, but types only the hot actions', () => {
    const schema = schemaOf(register())

    expect(schema.properties.action?.enum).toEqual(expect.arrayContaining(['rename', 'spawn']))
    expect(schema.properties.action?.enum?.at(-1)).toBe('help')
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(['objective', 'sessionIds', 'delegationId', 'target', 'topic']),
    )
    // Properties only rarer actions use are described by help, not declared.
    for (const rare of ['query', 'catalogScope', 'scheduleKind', 'destinationPath', 'claims']) {
      expect(schema.properties).not.toHaveProperty(rare)
    }
    expect(JSON.stringify(schema)).not.toContain('"const"')
  })

  it('declares a union of object shapes as one object, so report stays short', () => {
    const target = schemaOf(register()).properties.target
    expect(target).toMatchObject({ type: 'object' })
    expect(target).not.toHaveProperty('anyOf')
  })

  it('lets Pi pass a rarer action with undeclared parameters on to the full contract check', async () => {
    const tool = register()
    const args = { action: 'rename', sessionId: 'session-a', title: 'Renamed' }

    expect(piValidates(tool, args)).toEqual(args)
    // A shared property keeps the union of its schemas: create's workspace is not spawn's.
    expect(() => piValidates(tool, { action: 'create', workspace: 'current' })).not.toThrow()
  })

  it('keeps only the essential rules in the system prompt and points at help', () => {
    const guidelines = register().promptGuidelines ?? []

    expect(guidelines.join('\n')).toContain('hive({ action: "help" })')
    expect(guidelines.join('\n')).toMatch(/timeoutMs ≤ 270000 per wait call/)
    expect(guidelines.join('\n')).not.toMatch(/catalogScope|Heartbeat|snapshotManifest/)
    expect(guidelines.length).toBeLessThanOrEqual(8)
  })

  it('returns every action with its parameters and every rule from help, without the Host', async () => {
    const text = await hiveHelpText(register(WORKER_CAPABILITIES))

    expect(text).toMatch(/- spawn\(objective\*, /)
    expect(text).toMatch(/- rename|- delegation_claim\(delegationId\*/)
    expect(text).toContain('Hive rules:')
    expect(text).toMatch(/catalogScope project/)
    expect(text).not.toMatch(/- launch\(/)
  })

  it('returns one action schema with its required properties for a topic', async () => {
    const help: unknown = JSON.parse(await hiveHelpText(register(), 'delegation_claim'))

    expect(help).toMatchObject({
      action: 'delegation_claim',
      parameters: { type: 'object', required: expect.arrayContaining(['delegationId', 'claims']) },
    })
  })

  it('refuses help for an action outside the grant', async () => {
    const tool = register(WORKER_CAPABILITIES)
    const result = await tool.execute(
      'help-call',
      { action: 'help', topic: 'launch' },
      undefined,
      undefined,
      fromPartial({}),
    )
    expect(result).toMatchObject({ isError: true })
  })

  it('passes help through the capability check before validation', () => {
    expect(register(WORKER_CAPABILITIES).prepareArguments?.({ action: 'help' })).toEqual({
      action: 'help',
    })
  })
})
