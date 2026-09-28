import type { Model } from '@earendil-works/pi-ai'
import { transformMessages } from '@earendil-works/pi-ai/api/transform-messages'
import type { McpGatewayResult } from '@shared/types/mcp'
import { describe, expect, it } from 'vitest'
import {
  ATTRIBUTION,
  approvingContext,
  DIRECT_SCREENSHOT_TOOL,
  gatewayWithCallResult,
  registeredTools,
  SCREENSHOT_BASE64,
  screenshotCallResult,
  textOf,
} from './mcp-tool-result-content.test-utils'

describe('MCP tool result binary normalization', () => {
  it('normalizes image MIME types and wrapped base64 before attaching them', async () => {
    const callResult: McpGatewayResult = {
      operation: 'call',
      text: 'MCP tool completed.',
      result: [{ type: 'image', data: 'iVBORw0K\nGgoAAAAN', mimeType: 'IMAGE/JPG; name=shot' }],
      attribution: ATTRIBUTION,
    }
    const tools = await registeredTools(gatewayWithCallResult(callResult))

    const result = await tools
      .get(DIRECT_SCREENSHOT_TOOL.modelName)
      ?.execute('tool-call-1', {}, undefined, undefined, approvingContext())

    expect(result?.content).toContainEqual({
      type: 'image',
      data: 'iVBORw0KGgoAAAAN',
      mimeType: 'image/jpeg',
    })
  })

  it('removes data URIs and opaque base64 strings from structured MCP content', async () => {
    const opaque = 'aB3+'.repeat(1_500)
    const callResult: McpGatewayResult = {
      operation: 'call',
      text: 'MCP tool completed.',
      result: {
        preview: 'Rendered data:image/png;base64,iVBORw0KGgoAAAANSUhEUg== inline',
        trace: opaque,
        pageId: 'page-1',
        sequence: 'ACGT'.repeat(1_500),
      },
      attribution: ATTRIBUTION,
    }
    const tools = await registeredTools(gatewayWithCallResult(callResult))

    const result = await tools
      .get(DIRECT_SCREENSHOT_TOOL.modelName)
      ?.execute('tool-call-1', {}, undefined, undefined, approvingContext())

    expect(result).toBeDefined()
    if (!result) return
    const text = textOf(result)
    expect(text).not.toContain('iVBORw0KGgoAAAANSUhEUg')
    expect(text).not.toContain(opaque.slice(0, 64))
    expect(text).toContain('Rendered [image/png data URI omitted:')
    expect(text).toContain('characters] inline')
    expect(text).toContain(`[base64 data omitted: ${String(opaque.length)} base64 characters]`)
    expect(text).toContain('"pageId":"page-1"')
    // Long single-case sequences such as DNA are data the model needs, not base64.
    expect(text).toContain('ACGT'.repeat(1_500))
  })

  it('keeps MCP error results flagged as errors', async () => {
    const tools = await registeredTools(
      gatewayWithCallResult({ ...screenshotCallResult(), isError: true }),
    )

    const result = await tools
      .get(DIRECT_SCREENSHOT_TOOL.modelName)
      ?.execute('tool-call-1', {}, undefined, undefined, approvingContext())

    expect(result).toMatchObject({ isError: true })
  })

  it('reaches a text-only model as a placeholder instead of base64', async () => {
    const tools = await registeredTools(gatewayWithCallResult(screenshotCallResult()))
    const result = await tools
      .get(DIRECT_SCREENSHOT_TOOL.modelName)
      ?.execute('tool-call-1', { format: 'png' }, undefined, undefined, approvingContext())
    expect(result).toBeDefined()
    if (!result) return
    const textOnlyModel: Model<'openai-completions'> = {
      id: 'GLM-5.3-Flash-EXL3',
      name: 'GLM 5.3 Flash',
      api: 'openai-completions',
      provider: 'spark',
      baseUrl: 'http://127.0.0.1:8888/v1',
      reasoning: true,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 458_752,
      maxTokens: 32_000,
    }

    const [message] = transformMessages(
      [
        {
          role: 'toolResult',
          toolCallId: 'tool-call-1',
          toolName: DIRECT_SCREENSHOT_TOOL.modelName,
          content: result.content,
          isError: false,
          timestamp: 1,
        },
      ],
      textOnlyModel,
    )

    expect(message?.role).toBe('toolResult')
    const serialized = JSON.stringify(message)
    expect(serialized).not.toContain(SCREENSHOT_BASE64.slice(0, 64))
    expect(serialized).toContain('(tool image omitted: model does not support images)')
    expect(serialized.length).toBeLessThan(2_000)
  })
})
