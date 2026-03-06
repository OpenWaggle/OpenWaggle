import {
  type DefaultMessageMetadataByModality,
  maxIterations,
  type StreamChunk,
  type TextAdapter,
  type TextOptions,
  toolDefinition,
} from '@tanstack/ai'
import { describe, expect, it, vi } from 'vitest'
import { createModelRunner } from './model-runner'
import type { OrchestrationServiceDeps, SamplingConfig } from './types'

const MODEL_ID = 'test-model'

type TestProviderOptions = Record<string, never>
type TestInputModalities = readonly ['text']

const TEST_INPUT_MODALITIES: TestInputModalities = ['text']
const TEST_METADATA_BY_MODALITY: DefaultMessageMetadataByModality = {
  text: undefined,
  image: undefined,
  audio: undefined,
  video: undefined,
  document: undefined,
}

const DEFAULT_QUALITY: SamplingConfig = {
  maxTokens: 256,
}

function createAdapter(): TextAdapter<
  typeof MODEL_ID,
  TestProviderOptions,
  TestInputModalities,
  DefaultMessageMetadataByModality
> {
  return {
    kind: 'text',
    name: 'test-adapter',
    model: MODEL_ID,
    '~types': {
      providerOptions: {},
      inputModalities: TEST_INPUT_MODALITIES,
      messageMetadataByModality: TEST_METADATA_BY_MODALITY,
    },
    chatStream(_options: TextOptions<TestProviderOptions>): AsyncIterable<StreamChunk> {
      return createStream([])
    },
    async structuredOutput(): Promise<{ data: unknown; rawText: string }> {
      return { data: {}, rawText: '' }
    },
  }
}

function createStream(chunks: readonly StreamChunk[]): AsyncIterable<StreamChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk
      }
    },
  }
}

function createTestDeps(
  chunks: readonly StreamChunk[],
  extractJson: OrchestrationServiceDeps['extractJson'] = (value) => ({ extracted: value }),
): {
  readonly deps: OrchestrationServiceDeps
  readonly chatMock: ReturnType<typeof vi.fn>
  readonly extractJsonMock: ReturnType<typeof vi.fn>
  readonly logger: {
    readonly debug: ReturnType<typeof vi.fn>
    readonly info: ReturnType<typeof vi.fn>
    readonly warn: ReturnType<typeof vi.fn>
    readonly error: ReturnType<typeof vi.fn>
  }
} {
  const unusedAsync = async (): Promise<never> => {
    throw new Error('unused in model-runner unit test')
  }
  const unusedSync = (): never => {
    throw new Error('unused in model-runner unit test')
  }
  const unusedCreateRunStore: OrchestrationServiceDeps['runRepository']['createRunStore'] = () => {
    throw new Error('unused in model-runner unit test')
  }
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
  const chatMock = vi.fn(() => createStream(chunks))
  const extractJsonMock = vi.fn(extractJson)
  type ResolutionResult = Parameters<OrchestrationServiceDeps['isResolutionError']>[0]
  type ResolutionError = Extract<ResolutionResult, { ok: false }>
  const isResolutionErrorStub: OrchestrationServiceDeps['isResolutionError'] = (
    result: ResolutionResult,
  ): result is ResolutionError => !result.ok
  const deps: OrchestrationServiceDeps = {
    now: () => 0,
    sleep: async () => undefined,
    randomId: () => 'run-id',
    logger,
    streamChunkSize: 50,
    streamChunkDelayMs: 0,
    loadProjectConfig: unusedAsync,
    resolveProviderAndQuality: unusedAsync,
    isResolutionError: isResolutionErrorStub,
    isReasoningModel: () => false,
    buildPersistedUserMessageParts: unusedSync,
    buildSamplingOptions: vi.fn(() => ({})),
    makeMessage: unusedSync,
    gatherProjectContext: unusedAsync,
    createExecutorTools: unusedAsync,
    runOpenWaggleOrchestration: unusedAsync,
    maxIterations,
    chat: chatMock,
    extractJson: extractJsonMock,
    runRepository: {
      createRunStore: unusedCreateRunStore,
    },
  }

  return { deps, chatMock, extractJsonMock, logger }
}

describe('createModelRunner', () => {
  it('concatenates streamed text and forwards text chunks', async () => {
    const textChunks: StreamChunk[] = [
      { type: 'TEXT_MESSAGE_CONTENT', timestamp: 1, messageId: 'm-1', delta: 'hello ' },
      { type: 'TEXT_MESSAGE_CONTENT', timestamp: 2, messageId: 'm-1', delta: 'world' },
    ]
    const { deps, chatMock } = createTestDeps(textChunks)
    const onChunk = vi.fn()

    const runner = createModelRunner(deps)
    const result = await runner.modelText(createAdapter(), 'say hello', DEFAULT_QUALITY, onChunk)

    expect(result).toBe('hello world')
    expect(onChunk).toHaveBeenCalledTimes(2)
    expect(chatMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'say hello' }],
        maxTokens: DEFAULT_QUALITY.maxTokens,
      }),
    )
  })

  it('reconstructs tool inputs from streamed args when TOOL_CALL_END omits parsed input', async () => {
    const chunks: StreamChunk[] = [
      { type: 'TOOL_CALL_START', timestamp: 1, toolCallId: 'tool-1', toolName: 'readFile' },
      {
        type: 'TOOL_CALL_ARGS',
        timestamp: 2,
        toolCallId: 'tool-1',
        delta: '{"path":"README.md"}',
      },
      {
        type: 'TOOL_CALL_END',
        timestamp: 3,
        toolCallId: 'tool-1',
        toolName: 'readFile',
      },
      { type: 'TEXT_MESSAGE_CONTENT', timestamp: 4, messageId: 'm-1', delta: 'done' },
    ]
    const { deps, chatMock } = createTestDeps(chunks)
    const reportProgress = vi.fn()

    const runner = createModelRunner(deps)
    const result = await runner.modelTextWithTools(
      createAdapter(),
      'use tools',
      DEFAULT_QUALITY,
      [],
      reportProgress,
    )

    expect(result).toBe('done')
    expect(chatMock).toHaveBeenCalled()
    expect(reportProgress).not.toHaveBeenCalled()
  })

  it('reports tool progress with reconstructed tool input when tools are enabled', async () => {
    const chunks: StreamChunk[] = [
      { type: 'TOOL_CALL_START', timestamp: 1, toolCallId: 'tool-1', toolName: 'readFile' },
      {
        type: 'TOOL_CALL_ARGS',
        timestamp: 2,
        toolCallId: 'tool-1',
        delta: '{"path":"README.md"}',
      },
      {
        type: 'TOOL_CALL_END',
        timestamp: 3,
        toolCallId: 'tool-1',
        toolName: 'readFile',
      },
      { type: 'TEXT_MESSAGE_CONTENT', timestamp: 4, messageId: 'm-1', delta: 'done' },
    ]
    const { deps } = createTestDeps(chunks)
    const reportProgress = vi.fn()

    const runner = createModelRunner(deps)
    const result = await runner.modelTextWithTools(
      createAdapter(),
      'use tools',
      DEFAULT_QUALITY,
      [
        toolDefinition({
          name: 'readFile',
          description: 'Read a file',
          inputSchema: { type: 'object', properties: {} },
        }).server(async () => 'ok'),
      ],
      reportProgress,
    )

    expect(result).toBe('done')
    expect(reportProgress).toHaveBeenCalledWith({
      type: 'tool_end',
      toolName: 'readFile',
      toolCallId: 'tool-1',
      toolInput: { path: 'README.md' },
    })
  })

  it('falls back to extractJson when planner output is wrapped in prose', async () => {
    const extractJsonMock = vi.fn<OrchestrationServiceDeps['extractJson']>(() => ({ ok: true }))
    const { deps } = createTestDeps(
      [
        {
          type: 'TEXT_MESSAGE_CONTENT',
          timestamp: 1,
          messageId: 'm-1',
          delta: 'Planner result: {"ok":true}',
        },
      ],
      extractJsonMock,
    )

    const runner = createModelRunner(deps)
    const result = await runner.modelJson(createAdapter(), 'plan', DEFAULT_QUALITY)

    expect(result).toEqual({ ok: true })
    expect(extractJsonMock).toHaveBeenCalledWith('Planner result: {"ok":true}')
  })

  it('throws a model error when the stream emits RUN_ERROR', async () => {
    const { deps, logger } = createTestDeps([
      {
        type: 'RUN_ERROR',
        timestamp: 1,
        error: { code: 'overloaded', message: 'Backend overloaded' },
      },
    ])

    const runner = createModelRunner(deps)

    await expect(runner.modelText(createAdapter(), 'hello', DEFAULT_QUALITY)).rejects.toThrow(
      'Model error [overloaded]: Backend overloaded',
    )
    expect(logger.error).toHaveBeenCalledWith('modelText: RUN_ERROR received', {
      code: 'overloaded',
      message: 'Backend overloaded',
    })
  })
})
