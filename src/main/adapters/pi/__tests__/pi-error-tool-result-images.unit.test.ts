import {
  type Context,
  type Message,
  type Model,
  normalizeContext,
  type TranscriptContext,
} from '@earendil-works/pi-ai'
import { stream as streamAnthropic } from '@earendil-works/pi-ai/api/anthropic-messages'
import { stream as streamBedrock } from '@earendil-works/pi-ai/api/bedrock-converse-stream'
import { decodeUnknownOrThrow, Schema, type SchemaType } from '@shared/schema'
import { describe, expect, it } from 'vitest'

// Regression for a stuck Session: a codemode script showed a screenshot with image() and
// then failed, so its tool result was an error that carried an image. Claude rejects that
// ("all content must be type `text` if `is_error` is true"), and because the result stays
// in history, every later request of the Session failed the same way. Pi 1.3.0 fixed it
// (earendil-works/pi#10794): the images move after the tool results of the turn, in the same
// user message, so Claude still sees them. These tests guard that behaviour across upgrades.

const IMAGE_PLACEHOLDER = '(image attached after the tool results)'
const IMAGE_CAPTION = 'Images from the error result of tool call tool-1 (codemode):'
const PNG_DATA = 'iVBORw0KGgo='

function contextWithToolResult(isError: boolean): TranscriptContext {
  const messages: Message[] = [
    { role: 'user', content: 'Take a screenshot', timestamp: 1 },
    {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'tool-1', name: 'codemode', arguments: {} }],
      api: 'anthropic-messages',
      provider: 'anthropic',
      model: 'other-model',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'toolUse',
      timestamp: 2,
    },
    {
      role: 'toolResult',
      toolCallId: 'tool-1',
      toolName: 'codemode',
      content: [
        { type: 'text', text: 'Script failed' },
        { type: 'image', data: PNG_DATA, mimeType: 'image/png' },
        { type: 'image', data: PNG_DATA, mimeType: 'image/png' },
        { type: 'text', text: 'Script error: boom' },
      ],
      isError,
      timestamp: 3,
    },
  ]
  const context: Context = { systemPrompt: 'System', messages }
  return normalizeContext(context)
}

function makeModel<TApi extends 'anthropic-messages' | 'bedrock-converse-stream'>(
  api: TApi,
  provider: string,
  id: string,
): Model<TApi> {
  return {
    id,
    name: id,
    provider,
    api,
    baseUrl: 'https://example.test',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 100_000,
    maxTokens: 1_000,
  }
}

class PayloadCaptured extends Error {}

/** Builds the provider request, records it, and stops before anything is sent. */
async function capturePayload(
  run: (onPayload: (payload: unknown) => never) => AsyncIterable<unknown>,
): Promise<unknown> {
  let captured: unknown
  const events = run((payload) => {
    captured = payload
    throw new PayloadCaptured()
  })
  for await (const _event of events) {
    // Drain until the stream reports the abort raised above.
  }
  expect(captured).toBeDefined()
  return captured
}

const anthropicBlockSchema = Schema.Struct({
  type: Schema.String,
  text: Schema.optional(Schema.String),
  is_error: Schema.optional(Schema.Boolean),
  content: Schema.optional(Schema.Unknown),
})
type AnthropicBlock = SchemaType<typeof anthropicBlockSchema>
const anthropicPayloadSchema = Schema.Struct({
  messages: Schema.Array(
    Schema.Struct({
      role: Schema.String,
      content: Schema.Union(Schema.String, Schema.Array(anthropicBlockSchema)),
    }),
  ),
})

/** The user message that carries the tool result. */
function anthropicToolResultMessage(payload: unknown) {
  const { messages } = decodeUnknownOrThrow(anthropicPayloadSchema, payload)
  const message = messages.find(
    (candidate) =>
      typeof candidate.content !== 'string' &&
      candidate.content.some((block) => block.type === 'tool_result'),
  )
  if (!message || typeof message.content === 'string') {
    throw new Error('No tool_result in the Anthropic request')
  }
  return message.content
}

const bedrockPayloadSchema = Schema.Struct({
  messages: Schema.Array(
    Schema.Struct({
      content: Schema.Array(
        Schema.Struct({
          text: Schema.optional(Schema.String),
          image: Schema.optional(Schema.Unknown),
          toolResult: Schema.optional(
            Schema.Struct({
              status: Schema.String,
              content: Schema.Array(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
            }),
          ),
        }),
      ),
    }),
  ),
})

/** The user message that carries the tool result. */
function bedrockToolResultMessage(payload: unknown) {
  const { messages } = decodeUnknownOrThrow(bedrockPayloadSchema, payload)
  const message = messages.find((candidate) => candidate.content.some((block) => block.toolResult))
  if (!message) throw new Error('No toolResult in the Bedrock request')
  return message.content
}

describe('Claude requests with an error tool result that carries images', () => {
  const anthropicModel = makeModel('anthropic-messages', 'anthropic', 'claude-test')
  const bedrockModel = makeModel(
    'bedrock-converse-stream',
    'amazon-bedrock',
    'eu.anthropic.claude-test',
  )

  it('moves the images of an Anthropic error tool result after the tool results', async () => {
    const payload = await capturePayload((onPayload) =>
      streamAnthropic(anthropicModel, contextWithToolResult(true), {
        apiKey: 'sk-ant-test',
        onPayload,
      }),
    )
    const [toolResult, caption, ...images] = anthropicToolResultMessage(payload)

    expect(toolResult?.type).toBe('tool_result')
    expect(toolResult?.is_error).toBe(true)
    // Text-only content is sent as a single string, which Claude accepts for an error.
    expect(toolResult?.content).toBe(
      ['Script failed', IMAGE_PLACEHOLDER, 'Script error: boom'].join('\n'),
    )
    expect(caption).toEqual({ type: 'text', text: IMAGE_CAPTION })
    expect(images.map((block) => block.type)).toEqual(['image', 'image'])
  })

  it('keeps the images of a successful Anthropic tool result in place', async () => {
    const payload = await capturePayload((onPayload) =>
      streamAnthropic(anthropicModel, contextWithToolResult(false), {
        apiKey: 'sk-ant-test',
        onPayload,
      }),
    )
    const blocks = anthropicToolResultMessage(payload)
    const content: readonly AnthropicBlock[] = decodeUnknownOrThrow(
      Schema.Array(anthropicBlockSchema),
      blocks[0]?.content,
    )

    expect(blocks).toHaveLength(1)
    expect(content.map((block) => block.type)).toEqual(['text', 'image', 'image', 'text'])
  })

  it('moves the images of a Bedrock Claude error tool result after the tool results', async () => {
    const payload = await capturePayload((onPayload) =>
      streamBedrock(bedrockModel, contextWithToolResult(true), {
        region: 'eu-west-1',
        onPayload,
      }),
    )
    const [toolResultBlock, caption, ...images] = bedrockToolResultMessage(payload)

    expect(toolResultBlock?.toolResult?.status).toBe('error')
    expect(toolResultBlock?.toolResult?.content).toEqual([
      { text: 'Script failed' },
      { text: IMAGE_PLACEHOLDER },
      { text: 'Script error: boom' },
    ])
    expect(caption).toEqual({ text: IMAGE_CAPTION })
    expect(images.every((block) => block.image !== undefined)).toBe(true)
    expect(images).toHaveLength(2)
  })

  it('keeps the images of a successful Bedrock tool result in place', async () => {
    const payload = await capturePayload((onPayload) =>
      streamBedrock(bedrockModel, contextWithToolResult(false), {
        region: 'eu-west-1',
        onPayload,
      }),
    )
    const blocks = bedrockToolResultMessage(payload)

    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.toolResult?.status).toBe('success')
    expect(blocks[0]?.toolResult?.content.filter((block) => 'image' in block)).toHaveLength(2)
  })
})
