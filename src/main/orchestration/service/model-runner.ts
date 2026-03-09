import { safeDecodeUnknown } from '@shared/schema'
import { jsonObjectSchema, jsonValueSchema } from '@shared/schemas/validation'
import type { JsonObject, JsonValue } from '@shared/types/json'
import { chooseBy } from '@shared/utils/decision'
import type { StreamChunk } from '@tanstack/ai'
import type { ModelRunner, OrchestrationServiceDeps, SamplingConfig } from './types'

const SLICE_ARG_2 = 300

const EXECUTOR_MAX_ITERATIONS = 20

export function createModelRunner(deps: OrchestrationServiceDeps): ModelRunner {
  async function modelText(
    adapter: Parameters<ModelRunner['modelText']>[0],
    prompt: string,
    quality: SamplingConfig,
    onChunk?: (chunk: StreamChunk) => void,
  ): Promise<string> {
    const samplingOptions = deps.buildSamplingOptions(quality)
    deps.logger.info('modelText: calling chat()', { promptLength: prompt.length })

    const stream = deps.chat({
      adapter,
      stream: true,
      messages: [{ role: 'user', content: prompt }],
      ...samplingOptions,
      maxTokens: quality.maxTokens,
      modelOptions: quality.modelOptions,
    })

    let result = ''
    for await (const chunk of stream) {
      chooseBy(chunk, 'type')
        .case('TEXT_MESSAGE_CONTENT', (value) => {
          result += value.delta
          onChunk?.(value)
          return null
        })
        .case('RUN_ERROR', (value) => {
          const code = value.error.code ?? 'unknown'
          const message = value.error.message
          deps.logger.error('modelText: RUN_ERROR received', { code, message })
          throw new Error(`Model error [${code}]: ${message}`)
        })
        .catchAll(() => null)
    }

    const trimmed = result.trim()
    deps.logger.info('modelText: chat() returned', { outputLength: trimmed.length })
    return trimmed
  }

  async function modelTextWithTools(
    adapter: Parameters<ModelRunner['modelTextWithTools']>[0],
    prompt: string,
    quality: SamplingConfig,
    tools: Parameters<ModelRunner['modelTextWithTools']>[3],
    reportProgress?: Parameters<ModelRunner['modelTextWithTools']>[4],
    onChunk?: (chunk: StreamChunk) => void,
  ): Promise<string> {
    if (tools.length === 0) {
      // Executor output is not user-facing — suppress raw text deltas
      const filtered = onChunk
        ? (chunk: StreamChunk) => {
            if (chunk.type !== 'TEXT_MESSAGE_CONTENT') onChunk(chunk)
          }
        : undefined
      return modelText(adapter, prompt, quality, filtered)
    }

    const samplingOptions = deps.buildSamplingOptions(quality)
    const stream = deps.chat({
      adapter,
      stream: true,
      messages: [{ role: 'user', content: prompt }],
      tools,
      ...samplingOptions,
      maxTokens: quality.maxTokens,
      modelOptions: quality.modelOptions,
      agentLoopStrategy: deps.maxIterations(EXECUTOR_MAX_ITERATIONS),
    })

    let result = ''
    let toolCalls = 0
    const pendingArgs = new Map<string, string>()

    for await (const chunk of stream) {
      chooseBy(chunk, 'type')
        .case('TEXT_MESSAGE_CONTENT', (value) => {
          result += value.delta
          return null
        })
        .case('STEP_STARTED', (value) => {
          onChunk?.(value)
          return null
        })
        .case('STEP_FINISHED', (value) => {
          onChunk?.(value)
          return null
        })
        .case('TOOL_CALL_START', (value) => {
          toolCalls += 1
          pendingArgs.set(value.toolCallId, '')
          return null
        })
        .case('TOOL_CALL_ARGS', (value) => {
          const existing = pendingArgs.get(value.toolCallId) ?? ''
          pendingArgs.set(value.toolCallId, existing + value.delta)
          return null
        })
        .case('TOOL_CALL_END', (value) => {
          let toolInput: Readonly<JsonObject> | undefined
          const inputResult = safeDecodeUnknown(jsonObjectSchema, value.input)
          if (inputResult.success) {
            toolInput = inputResult.data
          } else {
            const argsStr = pendingArgs.get(value.toolCallId)
            if (argsStr) {
              try {
                const argsResult = safeDecodeUnknown(jsonObjectSchema, JSON.parse(argsStr))
                if (argsResult.success) {
                  toolInput = argsResult.data
                }
              } catch {
                // Best-effort fallback from partial args stream.
              }
            }
          }

          pendingArgs.delete(value.toolCallId)
          deps.logger.info('executor tool_end', { toolName: value.toolName, toolInput })
          reportProgress?.({
            type: 'tool_end',
            toolName: value.toolName,
            toolCallId: value.toolCallId,
            toolInput,
          })
          return null
        })
        .case('RUN_ERROR', (value) => {
          const code = value.error.code ?? 'unknown'
          const message = value.error.message
          deps.logger.error('modelTextWithTools: RUN_ERROR received', { code, message })
          throw new Error(`Model error [${code}]: ${message}`)
        })
        .catchAll(() => null)
    }

    deps.logger.info('executor finished', { resultLength: result.length, toolCalls })
    return result.trim()
  }

  async function modelJson(
    adapter: Parameters<ModelRunner['modelJson']>[0],
    prompt: string,
    quality: SamplingConfig,
    onChunk?: (chunk: StreamChunk) => void,
  ): Promise<JsonValue> {
    // Planner output is JSON — suppress raw text deltas
    const filtered = onChunk
      ? (chunk: StreamChunk) => {
          if (chunk.type !== 'TEXT_MESSAGE_CONTENT') onChunk(chunk)
        }
      : undefined
    const text = await modelText(adapter, prompt, quality, filtered)
    const trimmed = text.trim()
    if (!trimmed) {
      deps.logger.warn('modelJson: modelText returned empty — possible swallowed error')
    }

    try {
      const parsed = JSON.parse(trimmed)
      const parseResult = safeDecodeUnknown(jsonValueSchema, parsed)
      if (parseResult.success) {
        return parseResult.data
      }
    } catch {
      // Continue to extractJson fallback.
    }

    try {
      return deps.extractJson(trimmed)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      deps.logger.warn('modelJson extraction failure', {
        reason,
        rawLength: text.length,
        rawStart: text.slice(0, SLICE_ARG_2),
      })
      throw new Error(`Planner output could not be parsed as JSON: ${reason}`)
    }
  }

  return {
    modelText,
    modelTextWithTools,
    modelJson,
  }
}
