import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import {
  type ConstrainedModelMessage,
  chat,
  type DefaultMessageMetadataByModality,
  type StreamChunk,
  type TextAdapter,
  type TextOptions,
  toolDefinition,
} from '@tanstack/ai'
import { describe, expect, it } from 'vitest'

const BASE_TIMESTAMP_MS = 1_700_000_000_000
const FINISH_TIMESTAMP_OFFSET_MS = 1
const MODEL_ID = 'probe-model'
const RUN_ID = 'probe-run'
const TOOL_CALL_ID = 'probe-tool-call-id'
const TOOL_NAME = 'continuationProbeTool'
const CONVERSATION_ID = 'tanstack-known-issues-probe'

type ProbeProviderOptions = Record<string, never>
type ProbeInputModalities = readonly ['text']

type ProbeAdapterMessageMetadata = DefaultMessageMetadataByModality
type ProbeInputModalitiesTypes = {
  inputModalities: ProbeInputModalities
  messageMetadataByModality: ProbeAdapterMessageMetadata
}
type ProbeMessage = ConstrainedModelMessage<ProbeInputModalitiesTypes>

const PROBE_INPUT_MODALITIES: ProbeInputModalities = ['text']
const PROBE_METADATA_BY_MODALITY: ProbeAdapterMessageMetadata = {
  text: undefined,
  image: undefined,
  audio: undefined,
  video: undefined,
  document: undefined,
}

function createContinuationProbeAdapter(
  chunks: readonly StreamChunk[],
): TextAdapter<
  typeof MODEL_ID,
  ProbeProviderOptions,
  ProbeInputModalities,
  ProbeAdapterMessageMetadata
> {
  return {
    kind: 'text',
    name: 'continuation-probe',
    model: MODEL_ID,
    '~types': {
      providerOptions: {},
      inputModalities: PROBE_INPUT_MODALITIES,
      messageMetadataByModality: PROBE_METADATA_BY_MODALITY,
    },
    async *chatStream(_options: TextOptions<ProbeProviderOptions>): AsyncIterable<StreamChunk> {
      for (const chunk of chunks) {
        yield chunk
      }
    },
    async structuredOutput(_options: unknown): Promise<{ data: unknown; rawText: string }> {
      return {
        data: {},
        rawText: '',
      }
    },
  }
}

const CONTINUATION_MESSAGES: readonly ProbeMessage[] = [
  {
    role: 'assistant',
    content: null,
    toolCalls: [
      {
        id: TOOL_CALL_ID,
        type: 'function',
        function: {
          name: TOOL_NAME,
          arguments: '{"value":"hello"}',
        },
      },
    ],
  },
  {
    role: 'tool',
    toolCallId: TOOL_CALL_ID,
    content: '{"pendingExecution":true,"approved":true}',
  },
  {
    role: 'user',
    content: 'continue',
  },
]

const CONTINUATION_PROBE_TOOL = toolDefinition({
  name: TOOL_NAME,
  description: 'Deterministic tool for continuation chunk probes.',
  inputSchema: Schema.Struct({ value: Schema.String }),
}).server(async (rawArgs: unknown) => {
  const { value } = decodeUnknownOrThrow(
    Schema.Struct({
      value: Schema.String,
    }),
    rawArgs,
  )

  return {
    kind: 'text',
    text: value,
  }
})

async function collectContinuationProbeChunks(): Promise<readonly StreamChunk[]> {
  const adapter = createContinuationProbeAdapter([
    {
      type: 'RUN_STARTED',
      timestamp: BASE_TIMESTAMP_MS,
      runId: RUN_ID,
    },
    {
      type: 'RUN_FINISHED',
      timestamp: BASE_TIMESTAMP_MS + FINISH_TIMESTAMP_OFFSET_MS,
      runId: RUN_ID,
      finishReason: 'stop',
    },
  ])

  const stream = chat({
    adapter,
    messages: [...CONTINUATION_MESSAGES],
    tools: [CONTINUATION_PROBE_TOOL],
    conversationId: CONVERSATION_ID,
  })

  const chunks: StreamChunk[] = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }

  return chunks
}

function isToolChunkForProbeCall(chunk: StreamChunk): boolean {
  if (chunk.type === 'TOOL_CALL_START') {
    return chunk.toolCallId === TOOL_CALL_ID
  }
  if (chunk.type === 'TOOL_CALL_ARGS') {
    return chunk.toolCallId === TOOL_CALL_ID
  }
  if (chunk.type === 'TOOL_CALL_END') {
    return chunk.toolCallId === TOOL_CALL_ID
  }
  return false
}

const INCOMPLETE_TOOL_CALL_ID = 'incomplete-tc-1'
const INCOMPLETE_TOOL_NAME = 'incompleteProbe'
const INCOMPLETE_RUN_ID = 'incomplete-run'
const INCOMPLETE_MESSAGE_ID = 'incomplete-msg'
const CONTINUATION_TEXT = 'tool result received'

const INCOMPLETE_PROBE_TOOL = toolDefinition({
  name: INCOMPLETE_TOOL_NAME,
  description: 'Tool for testing response.incomplete continuation.',
  inputSchema: Schema.Struct({ query: Schema.String }),
}).server(async (rawArgs: unknown) => {
  const { query } = decodeUnknownOrThrow(Schema.Struct({ query: Schema.String }), rawArgs)
  return { kind: 'text', text: `result:${query}` }
})

/**
 * Creates an adapter that simulates the Codex `response.incomplete` scenario:
 *
 * First call: yields tool call chunks + RUN_FINISHED(finishReason: 'tool_calls')
 *   — mimics what our patched adapter emits when response.incomplete has function_calls
 * Second call (continuation): yields a simple text response + RUN_FINISHED(stop)
 */
function createIncompleteResponseProbeAdapter(): TextAdapter<
  typeof MODEL_ID,
  ProbeProviderOptions,
  ProbeInputModalities,
  ProbeAdapterMessageMetadata
> {
  let callCount = 0

  return {
    kind: 'text',
    name: 'incomplete-response-probe',
    model: MODEL_ID,
    '~types': {
      providerOptions: {},
      inputModalities: PROBE_INPUT_MODALITIES,
      messageMetadataByModality: PROBE_METADATA_BY_MODALITY,
    },
    async *chatStream(_options: TextOptions<ProbeProviderOptions>): AsyncIterable<StreamChunk> {
      callCount++
      if (callCount === 1) {
        // First response: tool calls + RUN_FINISHED(tool_calls)
        // Simulates what the patched adapter yields for response.incomplete with function_calls
        yield { type: 'RUN_STARTED', timestamp: BASE_TIMESTAMP_MS, runId: INCOMPLETE_RUN_ID }
        yield {
          type: 'TOOL_CALL_START',
          timestamp: BASE_TIMESTAMP_MS,
          toolCallId: INCOMPLETE_TOOL_CALL_ID,
          toolName: INCOMPLETE_TOOL_NAME,
          model: MODEL_ID,
        }
        yield {
          type: 'TOOL_CALL_ARGS',
          timestamp: BASE_TIMESTAMP_MS,
          toolCallId: INCOMPLETE_TOOL_CALL_ID,
          delta: '{"query":"test"}',
          model: MODEL_ID,
        }
        yield {
          type: 'TOOL_CALL_END',
          timestamp: BASE_TIMESTAMP_MS,
          toolCallId: INCOMPLETE_TOOL_CALL_ID,
          toolName: INCOMPLETE_TOOL_NAME,
          input: { query: 'test' },
          model: MODEL_ID,
        }
        yield {
          type: 'RUN_FINISHED',
          timestamp: BASE_TIMESTAMP_MS + FINISH_TIMESTAMP_OFFSET_MS,
          runId: INCOMPLETE_RUN_ID,
          finishReason: 'tool_calls',
        }
      } else {
        // Continuation: simple text response
        yield { type: 'RUN_STARTED', timestamp: BASE_TIMESTAMP_MS, runId: INCOMPLETE_RUN_ID }
        yield {
          type: 'TEXT_MESSAGE_START',
          timestamp: BASE_TIMESTAMP_MS,
          messageId: INCOMPLETE_MESSAGE_ID,
          model: MODEL_ID,
          role: 'assistant',
        }
        yield {
          type: 'TEXT_MESSAGE_CONTENT',
          timestamp: BASE_TIMESTAMP_MS,
          messageId: INCOMPLETE_MESSAGE_ID,
          model: MODEL_ID,
          delta: CONTINUATION_TEXT,
          content: CONTINUATION_TEXT,
        }
        yield {
          type: 'TEXT_MESSAGE_END',
          timestamp: BASE_TIMESTAMP_MS,
          messageId: INCOMPLETE_MESSAGE_ID,
          model: MODEL_ID,
        }
        yield {
          type: 'RUN_FINISHED',
          timestamp: BASE_TIMESTAMP_MS + FINISH_TIMESTAMP_OFFSET_MS,
          runId: INCOMPLETE_RUN_ID,
          finishReason: 'stop',
        }
      }
    },
    async structuredOutput(_options: unknown): Promise<{ data: unknown; rawText: string }> {
      return { data: {}, rawText: '' }
    },
  }
}

describe('TanStack known issues probes', () => {
  it('replays pending continuation tool calls as TOOL_CALL_END chunks', async () => {
    const chunks = await collectContinuationProbeChunks()

    const toolEndChunks = chunks.filter(
      (chunk): chunk is Extract<StreamChunk, { type: 'TOOL_CALL_END' }> =>
        chunk.type === 'TOOL_CALL_END' && chunk.toolCallId === TOOL_CALL_ID,
    )

    expect(toolEndChunks).toHaveLength(1)
    expect(toolEndChunks[0]?.result).toContain('hello')
  })

  it('emits full TOOL_CALL_START + TOOL_CALL_ARGS + TOOL_CALL_END for continuation re-executions (patched)', async () => {
    const chunks = await collectContinuationProbeChunks()

    const probeToolChunks = chunks.filter(isToolChunkForProbeCall)
    const startCount = probeToolChunks.filter((chunk) => chunk.type === 'TOOL_CALL_START').length
    const argsCount = probeToolChunks.filter((chunk) => chunk.type === 'TOOL_CALL_ARGS').length
    const endCount = probeToolChunks.filter((chunk) => chunk.type === 'TOOL_CALL_END').length

    // After our patch to @tanstack/ai, continuation re-executions now emit
    // the full chunk sequence. If this regresses (e.g. patch is lost on upgrade),
    // these assertions will fail — re-evaluate the patch and workarounds.
    expect(startCount).toBe(1)
    expect(argsCount).toBe(1)
    expect(endCount).toBe(1)
  })

  it('continues after RUN_FINISHED(tool_calls) by executing tools and requesting continuation (response.incomplete fix)', async () => {
    const adapter = createIncompleteResponseProbeAdapter()

    const stream = chat({
      adapter,
      messages: [{ role: 'user', content: 'run the tool' }],
      tools: [INCOMPLETE_PROBE_TOOL],
      conversationId: 'incomplete-response-probe',
    })

    const chunks: StreamChunk[] = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    // The engine should have:
    // 1. Received tool calls from first response (RUN_FINISHED with 'tool_calls')
    // 2. Executed the tool
    // 3. Sent a continuation request (second adapter call)
    // 4. Received text from continuation

    // The engine re-emits TOOL_CALL_END during execution (per the existing
    // @tanstack/ai patch). Filter for the one with a result — that's the
    // execution result, confirming the tool was actually run.
    const toolEndWithResult = chunks.filter(
      (chunk): chunk is Extract<StreamChunk, { type: 'TOOL_CALL_END' }> =>
        chunk.type === 'TOOL_CALL_END' &&
        chunk.toolCallId === INCOMPLETE_TOOL_CALL_ID &&
        typeof chunk.result === 'string',
    )
    expect(toolEndWithResult).toHaveLength(1)
    expect(toolEndWithResult[0]?.result).toContain('result:test')

    // Verify the continuation produced text output
    const textContentChunks = chunks.filter(
      (chunk): chunk is Extract<StreamChunk, { type: 'TEXT_MESSAGE_CONTENT' }> =>
        chunk.type === 'TEXT_MESSAGE_CONTENT',
    )
    expect(textContentChunks.length).toBeGreaterThanOrEqual(1)
    expect(textContentChunks.some((chunk) => chunk.content?.includes(CONTINUATION_TEXT))).toBe(true)

    // Verify final RUN_FINISHED has 'stop' (continuation completed normally)
    const runFinishedChunks = chunks.filter(
      (chunk): chunk is Extract<StreamChunk, { type: 'RUN_FINISHED' }> =>
        chunk.type === 'RUN_FINISHED',
    )
    const lastFinished = runFinishedChunks[runFinishedChunks.length - 1]
    expect(lastFinished?.finishReason).toBe('stop')
  })
})
