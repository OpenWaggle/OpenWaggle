import type { MessagePart } from '@shared/types/agent'
import { ToolCallId } from '@shared/types/brand'
import type { StreamChunk } from '@tanstack/ai'
import { createLogger } from '../logger'
import type { AgentToolCallEndEvent, AgentToolCallStartEvent } from './runtime-types'

const logger = createLogger('stream')

export interface StreamPartCollectorChunkResult {
  readonly toolCallStart?: AgentToolCallStartEvent
  readonly toolCallEnd?: AgentToolCallEndEvent
  readonly runError?: Error
}

export interface StreamPartCollectorStats {
  readonly toolCalls: number
  readonly toolErrors: number
}

function detectToolResultError(result: unknown): boolean {
  if (typeof result === 'string') {
    try {
      const parsed = JSON.parse(result) as unknown
      return detectToolResultError(parsed)
    } catch {
      return false
    }
  }

  if (typeof result !== 'object' || result === null) return false

  const maybeRecord = result as { error?: unknown; ok?: unknown }
  if (maybeRecord.ok === false) return true
  return typeof maybeRecord.error === 'string' && maybeRecord.error.length > 0
}

export class StreamPartCollector {
  private currentText = ''
  private readonly collectedParts: MessagePart[] = []
  private readonly toolCallArgs: Record<string, string> = {}
  private readonly toolCallStartTimes: Record<string, number> = {}
  private readonly emittedToolCallIds = new Set<string>()
  private readonly emittedToolResultIds = new Set<string>()

  private toolCalls = 0
  private toolErrors = 0

  handleChunk(chunk: StreamChunk): StreamPartCollectorChunkResult {
    switch (chunk.type) {
      case 'TEXT_MESSAGE_CONTENT':
        this.currentText += chunk.delta
        return {}

      case 'TOOL_CALL_START': {
        this.flushTextPart()
        const startedAt = Date.now()
        this.toolCallArgs[chunk.toolCallId] = ''
        this.toolCallStartTimes[chunk.toolCallId] = startedAt

        return {
          toolCallStart: {
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            startedAt,
          },
        }
      }

      case 'TOOL_CALL_ARGS': {
        this.toolCallArgs[chunk.toolCallId] =
          (this.toolCallArgs[chunk.toolCallId] ?? '') + chunk.delta
        return {}
      }

      case 'TOOL_CALL_END': {
        const args = this.parseToolArgs(chunk.toolCallId, chunk.toolName)
        if (!this.emittedToolCallIds.has(chunk.toolCallId)) {
          this.collectedParts.push({
            type: 'tool-call',
            toolCall: { id: ToolCallId(chunk.toolCallId), name: chunk.toolName, args },
          })
          this.emittedToolCallIds.add(chunk.toolCallId)
          this.toolCalls += 1
        }

        const startTime = this.toolCallStartTimes[chunk.toolCallId]
        const durationMs = startTime ? Date.now() - startTime : 0

        if (chunk.result === undefined) {
          return {
            toolCallEnd: {
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
              args,
              durationMs,
              isError: false,
            },
          }
        }

        const isError = detectToolResultError(chunk.result)
        if (isError && !this.emittedToolResultIds.has(chunk.toolCallId)) {
          this.toolErrors += 1
        }

        const resultString =
          typeof chunk.result === 'string' ? chunk.result : JSON.stringify(chunk.result)

        if (!this.emittedToolResultIds.has(chunk.toolCallId)) {
          this.collectedParts.push({
            type: 'tool-result',
            toolResult: {
              id: ToolCallId(chunk.toolCallId),
              name: chunk.toolName,
              args,
              result: resultString,
              isError,
              duration: durationMs,
            },
          })
          this.emittedToolResultIds.add(chunk.toolCallId)
        }

        return {
          toolCallEnd: {
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            args,
            result: resultString,
            durationMs,
            isError,
          },
        }
      }

      case 'RUN_ERROR': {
        this.flushTextPart()
        this.collectedParts.push({
          type: 'text',
          text: `\n\n**Error:** ${chunk.error.message}`,
        })

        return {
          runError: new Error(chunk.error.message),
        }
      }

      case 'RUN_FINISHED':
        return {}
    }

    return {}
  }

  finalizeParts(): MessagePart[] {
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

  private parseToolArgs(toolCallId: string, toolName: string): Record<string, unknown> {
    const rawArgs = this.toolCallArgs[toolCallId] ?? '{}'

    try {
      return JSON.parse(rawArgs) as Record<string, unknown>
    } catch (parseError) {
      logger.warn(`Failed to parse tool call args for "${toolName}"`, {
        error: parseError instanceof Error ? parseError.message : String(parseError),
        raw: rawArgs.slice(0, 200),
      })
      return {}
    }
  }
}
