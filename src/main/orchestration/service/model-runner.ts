import { unknownRecordSchema } from '@shared/schemas/validation'
import type { StreamChunk } from '@tanstack/ai'
import type { ModelRunner, OrchestrationServiceDeps, SamplingConfig } from './types'

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
      if (chunk.type === 'TEXT_MESSAGE_CONTENT') {
        result += chunk.delta
      } else if (chunk.type === 'STEP_STARTED' || chunk.type === 'STEP_FINISHED') {
        onChunk?.(chunk)
      } else if (chunk.type === 'RUN_ERROR') {
        const code = chunk.error.code ?? 'unknown'
        const message = chunk.error.message
        deps.logger.error('modelText: RUN_ERROR received', { code, message })
        throw new Error(`Model error [${code}]: ${message}`)
      }
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
      return modelText(adapter, prompt, quality, onChunk)
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
      if (chunk.type === 'TEXT_MESSAGE_CONTENT') {
        result += chunk.delta
      } else if (chunk.type === 'STEP_STARTED' || chunk.type === 'STEP_FINISHED') {
        onChunk?.(chunk)
      } else if (chunk.type === 'TOOL_CALL_START') {
        toolCalls += 1
        pendingArgs.set(chunk.toolCallId, '')
      } else if (chunk.type === 'TOOL_CALL_ARGS') {
        const existing = pendingArgs.get(chunk.toolCallId) ?? ''
        pendingArgs.set(chunk.toolCallId, existing + chunk.delta)
      } else if (chunk.type === 'TOOL_CALL_END') {
        let toolInput: Readonly<Record<string, unknown>> | undefined
        const inputResult = unknownRecordSchema.safeParse(chunk.input)
        if (inputResult.success) {
          toolInput = inputResult.data
        } else {
          const argsStr = pendingArgs.get(chunk.toolCallId)
          if (argsStr) {
            try {
              const argsUnknown: unknown = JSON.parse(argsStr)
              const argsResult = unknownRecordSchema.safeParse(argsUnknown)
              if (argsResult.success) {
                toolInput = argsResult.data
              }
            } catch {
              // Best-effort fallback from partial args stream.
            }
          }
        }

        pendingArgs.delete(chunk.toolCallId)
        deps.logger.info('executor tool_end', { toolName: chunk.toolName, toolInput })
        reportProgress?.({
          type: 'tool_end',
          toolName: chunk.toolName,
          toolCallId: chunk.toolCallId,
          toolInput,
        })
      } else if (chunk.type === 'RUN_ERROR') {
        const code = chunk.error.code ?? 'unknown'
        const message = chunk.error.message
        deps.logger.error('modelTextWithTools: RUN_ERROR received', { code, message })
        throw new Error(`Model error [${code}]: ${message}`)
      }
    }

    deps.logger.info('executor finished', { resultLength: result.length, toolCalls })
    return result.trim()
  }

  async function modelJson(
    adapter: Parameters<ModelRunner['modelJson']>[0],
    prompt: string,
    quality: SamplingConfig,
    onChunk?: (chunk: StreamChunk) => void,
  ): Promise<unknown> {
    const text = await modelText(adapter, prompt, quality, onChunk)
    const trimmed = text.trim()
    if (!trimmed) {
      deps.logger.warn('modelJson: modelText returned empty — possible swallowed error')
    }

    try {
      const data: unknown = JSON.parse(trimmed)
      return data
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
        rawStart: text.slice(0, 300),
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
