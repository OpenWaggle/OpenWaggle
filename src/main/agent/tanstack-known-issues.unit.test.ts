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
import { z } from 'zod'

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
  inputSchema: z.object({ value: z.string() }),
}).server(async ({ value }) => ({
  kind: 'text',
  text: value,
}))

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

  it('currently emits end-only chunks for continuation re-executions (upstream sentinel)', async () => {
    const chunks = await collectContinuationProbeChunks()

    const probeToolChunks = chunks.filter(isToolChunkForProbeCall)
    const startCount = probeToolChunks.filter((chunk) => chunk.type === 'TOOL_CALL_START').length
    const argsCount = probeToolChunks.filter((chunk) => chunk.type === 'TOOL_CALL_ARGS').length
    const endCount = probeToolChunks.filter((chunk) => chunk.type === 'TOOL_CALL_END').length

    expect(startCount).toBe(0)
    expect(argsCount).toBe(0)
    expect(endCount).toBe(1)
  })
})
