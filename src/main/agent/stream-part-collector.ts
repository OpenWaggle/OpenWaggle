import { jsonObjectSchema } from '@shared/schemas/validation'
import type { MessagePart } from '@shared/types/agent'
import { ToolCallId } from '@shared/types/brand'
import type { JsonObject } from '@shared/types/json'
import { chooseBy } from '@shared/utils/decision'
import type { StreamChunk } from '@tanstack/ai'
import { z } from 'zod'
import { createLogger } from '../logger'
import type { AgentToolCallEndEvent, AgentToolCallStartEvent } from './runtime-types'

const SLICE_ARG_PREVIEW_CHARS = 200
const UNRESOLVED_TOOL_CALL_ERROR = 'Tool call did not complete before the stream ended.'
const UNKNOWN_TOOL_NAME = 'unknownTool'
const DEFAULT_APPROVAL_REQUIRED = true

const logger = createLogger('stream')

const errorResultSchema = z.union([
  z.object({ ok: z.literal(false), error: z.string().min(1) }),
  z.object({ ok: z.literal(false), message: z.string().min(1) }),
  z.object({ error: z.string().min(1) }),
])

const approvalRequestedPayloadSchema = z
  .object({
    toolCallId: z.string(),
    toolName: z.string().optional(),
    approval: z.object({
      id: z.string(),
      needsApproval: z.boolean().optional(),
      approved: z.boolean().optional(),
    }),
  })
  .loose()

export interface StreamPartCollectorChunkResult {
  readonly toolCallStart?: AgentToolCallStartEvent
  readonly toolCallEnd?: AgentToolCallEndEvent
  readonly runError?: Error
}

export interface StreamPartCollectorStats {
  readonly toolCalls: number
  readonly toolErrors: number
}

export interface StreamPartCollectorFinalizeOptions {
  readonly timedOut?: boolean
  readonly preserveUnresolvedToolCallIds?: ReadonlySet<string>
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
  private readonly toolCallArgs = new Map<string, string>()
  private readonly toolCallNames = new Map<string, string>()
  private readonly toolCallStartTimes = new Map<string, number>()
  private readonly toolCallPartIndexes = new Map<string, number>()
  private readonly toolCallApprovalStates = new Map<
    string,
    { readonly id: string; readonly needsApproval: boolean; readonly approved?: boolean }
  >()
  private readonly toolCallStates = new Map<
    string,
    'input-complete' | 'approval-requested' | 'approval-responded'
  >()
  private readonly pendingToolCallIds = new Set<string>()
  private readonly awaitingToolResultIds = new Set<string>()
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
        this.toolCallNames.set(value.toolCallId, value.toolName)
        this.toolCallArgs.set(value.toolCallId, '')
        this.toolCallStartTimes.set(value.toolCallId, startedAt)
        this.toolCallStates.set(value.toolCallId, 'input-complete')
        this.pendingToolCallIds.add(value.toolCallId)

        return {
          toolCallStart: {
            toolCallId: value.toolCallId,
            toolName: value.toolName,
            startedAt,
          },
        }
      })
      .case('TOOL_CALL_ARGS', (value) => {
        this.toolCallArgs.set(
          value.toolCallId,
          (this.toolCallArgs.get(value.toolCallId) ?? '') + value.delta,
        )
        return {}
      })
      .case('TOOL_CALL_END', (value) => {
        this.pendingToolCallIds.delete(value.toolCallId)
        this.toolCallNames.set(value.toolCallId, value.toolName)
        const args = this.ensureToolCallPart(value.toolCallId, value.toolName)
        const durationMs = this.getDurationMs(value.toolCallId)

        if (value.result === undefined) {
          const completionState = 'input-complete' as const
          this.awaitingToolResultIds.add(value.toolCallId)
          return {
            toolCallEnd: {
              toolCallId: value.toolCallId,
              toolName: value.toolName,
              args,
              durationMs,
              isError: false,
              completionState,
            },
          }
        }

        this.awaitingToolResultIds.delete(value.toolCallId)
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
            completionState: 'execution-complete' as const,
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
      .case('CUSTOM', (value) => {
        if (value.name !== 'approval-requested') {
          return {}
        }

        const approvalEvent = approvalRequestedPayloadSchema.safeParse(value.value)
        if (!approvalEvent.success) {
          return {}
        }

        const toolCallId = approvalEvent.data.toolCallId
        const toolName =
          approvalEvent.data.toolName ?? this.toolCallNames.get(toolCallId) ?? UNKNOWN_TOOL_NAME
        this.toolCallNames.set(toolCallId, toolName)
        this.toolCallStates.set(toolCallId, 'approval-requested')
        this.toolCallApprovalStates.set(toolCallId, {
          id: approvalEvent.data.approval.id,
          needsApproval: approvalEvent.data.approval.needsApproval ?? DEFAULT_APPROVAL_REQUIRED,
          approved: approvalEvent.data.approval.approved,
        })
        this.ensureToolCallPart(toolCallId, toolName)
        return {}
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

  hasIncompleteToolCalls(): boolean {
    return this.pendingToolCallIds.size > 0 || this.awaitingToolResultIds.size > 0
  }

  hasUnresolvedToolResults(): boolean {
    return this.awaitingToolResultIds.size > 0
  }

  finalizeParts(options: StreamPartCollectorFinalizeOptions = {}): MessagePart[] {
    this.flushReasoningPart()
    this.flushTextPart()
    const preservedUnresolvedToolCallIds =
      options.preserveUnresolvedToolCallIds ?? new Set<string>()
    this.appendSyntheticToolResultsForIncompleteCalls(
      options.timedOut ?? false,
      preservedUnresolvedToolCallIds,
    )

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

  private ensureToolCallPart(toolCallId: string, toolName: string): JsonObject {
    const resolvedName = this.toolCallNames.get(toolCallId) ?? toolName
    const args = this.parseToolArgs(toolCallId, resolvedName)

    if (!this.emittedToolCallIds.has(toolCallId)) {
      this.collectedParts.push({
        type: 'tool-call',
        toolCall: this.buildToolCallPayload(toolCallId, resolvedName, args),
      })
      this.toolCallPartIndexes.set(toolCallId, this.collectedParts.length - 1)
      this.emittedToolCallIds.add(toolCallId)
      this.toolCalls += 1
    } else {
      const existingIndex = this.toolCallPartIndexes.get(toolCallId)
      if (existingIndex !== undefined) {
        this.collectedParts[existingIndex] = {
          type: 'tool-call',
          toolCall: this.buildToolCallPayload(toolCallId, resolvedName, args),
        }
      }
    }

    return args
  }

  private buildToolCallPayload(toolCallId: string, toolName: string, args: JsonObject) {
    return {
      id: ToolCallId(toolCallId),
      name: toolName,
      args,
      state: this.toolCallStates.get(toolCallId),
      approval: this.toolCallApprovalStates.get(toolCallId),
    }
  }

  private getDurationMs(toolCallId: string): number {
    const startTime = this.toolCallStartTimes.get(toolCallId)
    return startTime ? Date.now() - startTime : 0
  }

  private appendSyntheticToolResultsForIncompleteCalls(
    timedOut: boolean,
    preserveUnresolvedToolCallIds: ReadonlySet<string>,
  ): void {
    if (!this.hasIncompleteToolCalls()) {
      return
    }

    const unresolvedToolCallIds = new Set([
      ...this.pendingToolCallIds,
      ...this.awaitingToolResultIds,
    ])

    for (const toolCallId of unresolvedToolCallIds) {
      if (this.emittedToolResultIds.has(toolCallId)) {
        continue
      }

      const toolName = this.toolCallNames.get(toolCallId) ?? UNKNOWN_TOOL_NAME
      const args = this.ensureToolCallPart(toolCallId, toolName)
      const durationMs = this.getDurationMs(toolCallId)
      const isAwaitingResult = this.awaitingToolResultIds.has(toolCallId)
      if (isAwaitingResult && (!timedOut || preserveUnresolvedToolCallIds.has(toolCallId))) {
        // `TOOL_CALL_END` without `result` commonly means approval/client-execution
        // pending. On normal completion (non-timeout), keep it unresolved so
        // continuation can complete instead of persisting a synthetic error.
        continue
      }
      const isError = true
      const result = JSON.stringify({
        ok: false,
        error: UNRESOLVED_TOOL_CALL_ERROR,
      })

      this.collectedParts.push({
        type: 'tool-result',
        toolResult: {
          id: ToolCallId(toolCallId),
          name: toolName,
          args,
          result,
          isError,
          duration: durationMs,
        },
      })
      this.emittedToolResultIds.add(toolCallId)
      this.toolErrors += 1
    }
  }

  private parseToolArgs(toolCallId: string, toolName: string): JsonObject {
    const rawArgs = this.toolCallArgs.get(toolCallId) ?? '{}'

    try {
      const parsed = jsonObjectSchema.parse(JSON.parse(rawArgs))
      return parsed
    } catch (parseError) {
      logger.warn(`Failed to parse tool call args for "${toolName}"`, {
        error: parseError instanceof Error ? parseError.message : String(parseError),
        raw: rawArgs.slice(0, SLICE_ARG_PREVIEW_CHARS),
      })
      return {}
    }
  }
}
