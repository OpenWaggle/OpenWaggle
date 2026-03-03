import { jsonObjectSchema } from '@shared/schemas/validation'
import type { MessagePart } from '@shared/types/agent'
import { ToolCallId } from '@shared/types/brand'
import type { JsonObject } from '@shared/types/json'
import { chooseBy } from '@shared/utils/decision'
import type { StreamChunk } from '@tanstack/ai'
import { z } from 'zod'
import { createLogger } from '../logger'
import type { AgentToolCallEndEvent, AgentToolCallStartEvent } from './runtime-types'

const SLICE_ARG_2 = 200

const logger = createLogger('stream')

const errorResultSchema = z.union([
  z.object({ ok: z.literal(false), error: z.string().min(1) }),
  z.object({ ok: z.literal(false), message: z.string().min(1) }),
  z.object({ error: z.string().min(1) }),
])

export interface StreamPartCollectorChunkResult {
  readonly toolCallStart?: AgentToolCallStartEvent
  readonly toolCallEnd?: AgentToolCallEndEvent
  readonly runError?: Error
}

export interface StreamPartCollectorStats {
  readonly toolCalls: number
  readonly toolErrors: number
}

export function detectToolResultError(result: unknown): boolean {
  if (typeof result === 'string') {
    try {
      const parsed: unknown = JSON.parse(result)
      return detectToolResultError(parsed)
    } catch {
      return false
    }
  }

  return errorResultSchema.safeParse(result).success
}

export class StreamPartCollector {
  private currentText = ''
  private currentReasoning = ''
  private readonly collectedParts: MessagePart[] = []
  private readonly toolCallArgs: Record<string, string> = {}
  private readonly toolCallStartTimes: Record<string, number> = {}
  private readonly emittedToolCallIds = new Set<string>()
  private readonly emittedToolResultIds = new Set<string>()

  private toolCalls = 0
  private toolErrors = 0

  handleChunk(chunk: StreamChunk): StreamPartCollectorChunkResult {
    return chooseBy(chunk, 'type')
      .case('TEXT_MESSAGE_CONTENT', (value) => {
        this.flushReasoningPart()
        this.currentText += value.delta
        return {}
      })
      .case('STEP_STARTED', () => {
        this.flushReasoningPart()
        this.flushTextPart()
        return {}
      })
      .case('STEP_FINISHED', (value) => {
        this.currentReasoning += value.delta
        return {}
      })
      .case('TOOL_CALL_START', (value) => {
        this.flushReasoningPart()
        this.flushTextPart()
        const startedAt = Date.now()
        this.toolCallArgs[value.toolCallId] = ''
        this.toolCallStartTimes[value.toolCallId] = startedAt

        return {
          toolCallStart: {
            toolCallId: value.toolCallId,
            toolName: value.toolName,
            startedAt,
          },
        }
      })
      .case('TOOL_CALL_ARGS', (value) => {
        this.toolCallArgs[value.toolCallId] =
          (this.toolCallArgs[value.toolCallId] ?? '') + value.delta
        return {}
      })
      .case('TOOL_CALL_END', (value) => {
        const args = this.parseToolArgs(value.toolCallId, value.toolName)
        if (!this.emittedToolCallIds.has(value.toolCallId)) {
          this.collectedParts.push({
            type: 'tool-call',
            toolCall: { id: ToolCallId(value.toolCallId), name: value.toolName, args },
          })
          this.emittedToolCallIds.add(value.toolCallId)
          this.toolCalls += 1
        }

        const startTime = this.toolCallStartTimes[value.toolCallId]
        const durationMs = startTime ? Date.now() - startTime : 0

        if (value.result === undefined) {
          return {
            toolCallEnd: {
              toolCallId: value.toolCallId,
              toolName: value.toolName,
              args,
              durationMs,
              isError: false,
            },
          }
        }

        const isError = detectToolResultError(value.result)
        if (isError && !this.emittedToolResultIds.has(value.toolCallId)) {
          this.toolErrors += 1
        }

        const resultString =
          typeof value.result === 'string' ? value.result : JSON.stringify(value.result)

        if (!this.emittedToolResultIds.has(value.toolCallId)) {
          this.collectedParts.push({
            type: 'tool-result',
            toolResult: {
              id: ToolCallId(value.toolCallId),
              name: value.toolName,
              args,
              result: resultString,
              isError,
              duration: durationMs,
            },
          })
          this.emittedToolResultIds.add(value.toolCallId)
        }

        return {
          toolCallEnd: {
            toolCallId: value.toolCallId,
            toolName: value.toolName,
            args,
            result: resultString,
            durationMs,
            isError,
          },
        }
      })
      .case('RUN_ERROR', (value) => {
        this.flushReasoningPart()
        this.flushTextPart()
        this.collectedParts.push({
          type: 'text',
          text: `\n\n**Error:** ${value.error.message}`,
        })

        return {
          runError: new Error(value.error.message),
        }
      })
      .case('RUN_FINISHED', () => ({}))
      .catchAll(() => ({}))
  }

  /**
   * Non-destructive read — returns accumulated parts plus any pending
   * text/reasoning WITHOUT flushing internal state. Used by stream-bridge
   * to snapshot progress for background run reconnection.
   */
  snapshotParts(): MessagePart[] {
    const snapshot = [...this.collectedParts]
    if (this.currentReasoning.trim()) {
      snapshot.push({ type: 'reasoning', text: this.currentReasoning })
    }
    if (this.currentText.trim()) {
      snapshot.push({ type: 'text', text: this.currentText })
    }
    return snapshot
  }

  finalizeParts(): MessagePart[] {
    this.flushReasoningPart()
    this.flushTextPart()

    if (this.collectedParts.length === 0) {
      return [{ type: 'text', text: '(no response)' }]
    }

    return [...this.collectedParts]
  }

  getStats(): StreamPartCollectorStats {
    return {
      toolCalls: this.toolCalls,
      toolErrors: this.toolErrors,
    }
  }

  private flushTextPart(): void {
    if (this.currentText.trim()) {
      this.collectedParts.push({ type: 'text', text: this.currentText })
      this.currentText = ''
    }
  }

  private flushReasoningPart(): void {
    if (this.currentReasoning.trim()) {
      this.collectedParts.push({ type: 'reasoning', text: this.currentReasoning })
      this.currentReasoning = ''
    }
  }

  private parseToolArgs(toolCallId: string, toolName: string): JsonObject {
    const rawArgs = this.toolCallArgs[toolCallId] ?? '{}'

    try {
      const parsed = jsonObjectSchema.parse(JSON.parse(rawArgs))
      return parsed
    } catch (parseError) {
      logger.warn(`Failed to parse tool call args for "${toolName}"`, {
        error: parseError instanceof Error ? parseError.message : String(parseError),
        raw: rawArgs.slice(0, SLICE_ARG_2),
      })
      return {}
    }
  }
}
