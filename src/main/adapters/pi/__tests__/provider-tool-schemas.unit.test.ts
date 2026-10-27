import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserPreviewAutomationServiceShape } from '../../../ports/browser-preview-automation-service'
import { createBrowserPreviewAutomationExtension } from '../browser-preview-automation-extension'
import { createProjectActionsToolExtension } from '../project-actions-tool-extension'
import { providerToolSchemaViolations } from '../provider-tool-parameter-schema'
import { createSessionsToolExtension } from '../sessions-tool-extension'
import { providerToolPayloads } from './provider-tool-payload.test-utils'

const browserPreviewService = fromPartial<BrowserPreviewAutomationServiceShape>({
  resize: vi.fn(() => Effect.succeed({ tabId: 'tab-1', viewport: { mode: 'fill' as const } })),
})

async function collect(factory: (pi: ExtensionAPI) => unknown) {
  const tools: ToolDefinition[] = []
  await factory(
    fromPartial<ExtensionAPI>({
      registerTool: (tool: ToolDefinition) => tools.push(tool),
      on: () => undefined,
    }),
  )
  return tools
}

async function openWaggleTools() {
  return [
    ...(await collect(
      createBrowserPreviewAutomationExtension({
        scope: { sessionId: SessionId('session-1'), workingPath: '/project' },
        service: browserPreviewService,
      }),
    )),
    ...(await collect(
      createProjectActionsToolExtension({
        sessionId: SessionId('session-1'),
        runId: 'run-1',
        catalog: fromPartial({}),
        runs: fromPartial({}),
        workspaces: fromPartial({}),
      }),
    )),
    ...(await collect(
      createSessionsToolExtension({
        sessionId: 'session-1',
        runId: 'run-1',
        workingDirectory: '/project',
      }),
    )),
  ]
}

function violationsByTool(schemas: ReadonlyMap<string, unknown>) {
  const violations: Record<string, readonly string[]> = {}
  for (const [name, schema] of schemas) {
    const found = providerToolSchemaViolations(schema)
    if (found.length > 0) violations[name] = found
  }
  return violations
}

describe('tool schemas OpenWaggle hands to Pi', () => {
  it('reach Bedrock and OpenAI with an object root for every OpenWaggle tool', async () => {
    const tools = await openWaggleTools()
    const payloads = await providerToolPayloads(tools)

    expect(payloads.bedrock.size).toBe(tools.length)
    expect(payloads.openai.size).toBe(tools.length)
    expect(violationsByTool(payloads.bedrock)).toEqual({})
    expect(violationsByTool(payloads.openai)).toEqual({})
  })

  it('send no TypeBox internal keys and keep per-action required notes', async () => {
    const payloads = await providerToolPayloads(await openWaggleTools())

    for (const payload of [payloads.bedrock, payloads.openai]) {
      const hive = JSON.stringify(payload.get('hive'))
      // Providers that reject unknown JSON Schema keywords would refuse the whole request.
      expect(JSON.stringify([...payload.values()])).not.toMatch(/"~[A-Za-z]+"/)
      // Only the hot actions' required properties are noted; help describes the others.
      expect(hive).toContain('"description":"Required for spawn."')
      expect(payload.has('sessions')).toBe(false)
    }
  })
})
