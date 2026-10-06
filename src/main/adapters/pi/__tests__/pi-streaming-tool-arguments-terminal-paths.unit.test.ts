import type { AssistantMessage } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'
import {
  JSON_ARGUMENTS,
  STREAMING_TOOL_CALL_PROVIDERS,
} from './streaming-provider-cases.test-utils'

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
})
