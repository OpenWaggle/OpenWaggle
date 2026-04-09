import type { StreamChunk } from '@tanstack/ai'
import { createOpenaiChat } from '@tanstack/ai-openai'
import { describe, expect, it } from 'vitest'

const MODEL_ID = 'gpt-4.1-nano'
const API_KEY = 'sk-test'
const TOOL_CALL_ID = 'fc_1'
const TOOL_NAME = 'listFiles'
const TOOL_ARGS = '{"path":"."}'

function createResponseEnvelope(status: 'in_progress' | 'incomplete' | 'completed'): {
  readonly id: string
  readonly object: 'response'
  readonly model: typeof MODEL_ID
  readonly status: 'in_progress' | 'incomplete' | 'completed'
  readonly output: readonly unknown[]
  readonly usage: {
    readonly input_tokens: number
    readonly output_tokens: number
    readonly total_tokens: number
  }
  readonly incomplete_details?: {
    readonly reason: 'max_output_tokens'
  }
} {
  return {
    id: 'resp_1',
    object: 'response',
    model: MODEL_ID,
    status,
    output: [],
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
    },
    ...(status === 'incomplete'
      ? {
          incomplete_details: {
            reason: 'max_output_tokens',
          },
        }
      : {}),
  }
}

function createToolCallEvents(): readonly unknown[] {
  return [
    {
      type: 'response.created',
      response: createResponseEnvelope('in_progress'),
    },
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: {
        type: 'function_call',
        id: TOOL_CALL_ID,
        call_id: TOOL_CALL_ID,
        name: TOOL_NAME,
        arguments: '',
        status: 'in_progress',
      },
    },
    {
      type: 'response.function_call_arguments.delta',
      item_id: TOOL_CALL_ID,
      output_index: 0,
      delta: TOOL_ARGS,
    },
    {
      type: 'response.function_call_arguments.done',
      item_id: TOOL_CALL_ID,
      output_index: 0,
      arguments: TOOL_ARGS,
    },
  ]
}

function createSseBody(events: readonly unknown[], includeDone = true): string {
  const lines = events.map((event) => `data: ${JSON.stringify(event)}\n\n`)
  return includeDone ? `${lines.join('')}data: [DONE]\n\n` : lines.join('')
}

async function collectAdapterChunks(
  events: readonly unknown[],
  includeDone = true,
): Promise<readonly StreamChunk[]> {
  const adapter = createOpenaiChat(MODEL_ID, API_KEY, {
    fetch: async () =>
      new Response(createSseBody(events, includeDone), {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
        },
      }),
  })

  const chunks: StreamChunk[] = []
  for await (const chunk of adapter.chatStream({
    model: MODEL_ID,
    messages: [{ role: 'user', content: 'run the tool' }],
  })) {
    chunks.push(chunk)
  }
  return chunks
}

function getToolCallChunks(chunks: readonly StreamChunk[]): readonly StreamChunk[] {
  return chunks.filter(
    (chunk) =>
      (chunk.type === 'TOOL_CALL_START' ||
        chunk.type === 'TOOL_CALL_ARGS' ||
        chunk.type === 'TOOL_CALL_END') &&
      chunk.toolCallId === TOOL_CALL_ID,
  )
}

function getRunFinishedChunks(
  chunks: readonly StreamChunk[],
): ReadonlyArray<Extract<StreamChunk, { type: 'RUN_FINISHED' }>> {
  return chunks.filter(
    (chunk): chunk is Extract<StreamChunk, { type: 'RUN_FINISHED' }> =>
      chunk.type === 'RUN_FINISHED',
  )
}

function getRunErrorChunks(
  chunks: readonly StreamChunk[],
): ReadonlyArray<Extract<StreamChunk, { type: 'RUN_ERROR' }>> {
  return chunks.filter(
    (chunk): chunk is Extract<StreamChunk, { type: 'RUN_ERROR' }> => chunk.type === 'RUN_ERROR',
  )
}

describe('OpenAI Codex streamed continuation adapter behavior', () => {
  it('treats response.incomplete after streamed tool calls as RUN_FINISHED(tool_calls)', async () => {
    const chunks = await collectAdapterChunks([
      ...createToolCallEvents(),
      {
        type: 'response.incomplete',
        response: createResponseEnvelope('incomplete'),
      },
    ])

    const toolCallChunks = getToolCallChunks(chunks)
    expect(toolCallChunks.map((chunk) => chunk.type)).toEqual([
      'TOOL_CALL_START',
      'TOOL_CALL_ARGS',
      'TOOL_CALL_END',
    ])

    const runFinishedChunks = getRunFinishedChunks(chunks)
    expect(runFinishedChunks).toHaveLength(1)
    expect(runFinishedChunks[0]?.finishReason).toBe('tool_calls')
    expect(getRunErrorChunks(chunks)).toHaveLength(0)
  })

  it('emits fallback RUN_FINISHED(tool_calls) when the stream ends after tool calls with no terminal event', async () => {
    const chunks = await collectAdapterChunks(createToolCallEvents())

    const runFinishedChunks = getRunFinishedChunks(chunks)
    expect(runFinishedChunks).toHaveLength(1)
    expect(runFinishedChunks[0]?.finishReason).toBe('tool_calls')
    expect(getRunErrorChunks(chunks)).toHaveLength(0)
  })

  it('keeps response.incomplete without streamed tool calls as RUN_ERROR', async () => {
    const chunks = await collectAdapterChunks([
      {
        type: 'response.created',
        response: createResponseEnvelope('in_progress'),
      },
      {
        type: 'response.incomplete',
        response: createResponseEnvelope('incomplete'),
      },
    ])

    expect(getRunFinishedChunks(chunks)).toHaveLength(0)
    expect(getRunErrorChunks(chunks)).toHaveLength(1)
  })

  it('ignores late terminal duplication after synthetic RUN_FINISHED(tool_calls)', async () => {
    const chunks = await collectAdapterChunks([
      ...createToolCallEvents(),
      {
        type: 'response.incomplete',
        response: createResponseEnvelope('incomplete'),
      },
      {
        type: 'response.completed',
        response: createResponseEnvelope('completed'),
      },
      {
        type: 'error',
        message: 'late terminal error',
      },
    ])

    const runFinishedChunks = getRunFinishedChunks(chunks)
    expect(runFinishedChunks).toHaveLength(1)
    expect(runFinishedChunks[0]?.finishReason).toBe('tool_calls')
    expect(getRunErrorChunks(chunks)).toHaveLength(0)
  })
})
