import type { AssistantMessage } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'
import {
  runAzureResponsesToolCall,
  runOpenAiResponsesToolCall,
} from './responses-streaming-cases.test-utils'
import { STREAMING_TOOL_CALL_PROVIDERS } from './streaming-provider-cases.test-utils'
import { JSON_ARGUMENTS } from './streaming-provider-wire.test-utils'

/**
 * Pi parses streamed tool-call JSON at a bounded rate, so a block's `arguments` can lag its
 * raw JSON until something parses it in full. Every patched provider must do that on every
 * terminal path, including a stream that ends normally without closing the tool block and a
 * stream that fails after the deltas, or a tool runs with truncated arguments.
 */

function expectExactToolCall(message: AssistantMessage) {
  const toolCall = message.content.find((block) => block.type === 'toolCall')
  expect(toolCall).toBeDefined()
  expect(toolCall?.arguments).toEqual(JSON.parse(JSON_ARGUMENTS))
  expect(toolCall).not.toHaveProperty('partialJson')
  expect(toolCall).not.toHaveProperty('partialArgs')
}

describe('Pi streaming tool-call arguments on terminal paths', () => {
  for (const provider of STREAMING_TOOL_CALL_PROVIDERS) {
    it(`${provider.name}: exact after ${provider.normalEnding}`, async () => {
      const message = await provider.run('normal')

      expect(message.errorMessage).toBeUndefined()
      expect(message.stopReason).toBe('toolUse')
      expectExactToolCall(message)
    })

    it(`${provider.name}: exact when the stream fails after the deltas`, async () => {
      const message = await provider.run('failure')

      expect(message.stopReason).toBe('error')
      expectExactToolCall(message)
    })
  }

  it('OpenAI Responses: refuses a call whose output_item.done never arrived, as Pi does since 1.0.4', async () => {
    const message = await runOpenAiResponsesToolCall('unfinished')

    expect(message.stopReason).toBe('error')
    expect(message.errorMessage).toContain('unfinished tool call: write')
  })

  // The parse at the end of processResponsesStream is the only one this ending reaches: the
  // call never got output_item.done, and a message that stops on length is not refused.
  it.each([
    ['OpenAI Responses', runOpenAiResponsesToolCall],
    ['Azure OpenAI Responses', runAzureResponsesToolCall],
  ])('%s: exact when the output token limit cuts the stream off', async (_name, run) => {
    const message = await run('length')

    expect(message.errorMessage).toBeUndefined()
    expect(message.stopReason).toBe('length')
    expectExactToolCall(message)
  })
})
