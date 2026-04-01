import { safeDecodeUnknown } from '@shared/schema'
import { planResponseSchema } from '@shared/types/plan'
import { askUserArgsSchema } from '@shared/types/question'
import { isUserBlockingToolName } from '@shared/types/tool-blocking'
import type { UIMessage } from '@tanstack/ai-react'

type MessagePart = UIMessage['parts'][number]

export interface OrchestrateTaskArg {
  id: string
  title: string
}

export function isRenderableTextPart(
  part: MessagePart,
): part is Extract<MessagePart, { type: 'text' }> {
  return part.type === 'text' && part.content.trim().length > 0
}

export function getLastRenderableTextPartIndex(parts: UIMessage['parts']): number {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (isRenderableTextPart(parts[index])) {
      return index
    }
  }
  return -1
}

/**
 * Returns true when the message has a proposePlan or askUser tool-call
 * without a matching tool-result. These tool calls require user interaction
 * (Approve/Revise or answer questions) and must never be collapsed behind
 * a "Show N tool calls" toggle — the user needs to see and interact with them.
 *
 * O(n) — collects answered tool-call IDs in a single pass, then checks
 * blocking tool-calls against the set.
 */
export function hasUnansweredBlockingToolCall(parts: UIMessage['parts']): boolean {
  const answeredToolCallIds = new Set<string>()
  for (const p of parts) {
    if (p.type === 'tool-result') {
      answeredToolCallIds.add(p.toolCallId)
    }
  }
  for (const p of parts) {
    if (
      p.type === 'tool-call' &&
      isUserBlockingToolName(p.name) &&
      !answeredToolCallIds.has(p.id)
    ) {
      return true
    }
  }
  return false
}

export function countToolCallParts(parts: UIMessage['parts']): number {
  let toolCallCount = 0
  for (const part of parts) {
    if (part.type === 'tool-call' && part.name !== '_turnBoundary') {
      toolCallCount += 1
    }
  }
  return toolCallCount
}

export function hasRenderableTextPartBeforeIndex(
  parts: UIMessage['parts'],
  index: number,
): boolean {
  if (index <= 0) {
    return false
  }
  for (let currentIndex = 0; currentIndex < index; currentIndex += 1) {
    if (isRenderableTextPart(parts[currentIndex])) {
      return true
    }
  }
  return false
}

export function countQuestions(argsJson: string): number {
  try {
    const parsed: unknown = JSON.parse(argsJson)
    const result = safeDecodeUnknown(askUserArgsSchema, parsed)
    return result.success ? result.data.questions.length : 1
  } catch {
    return 1
  }
}

export function getStringProperty(value: unknown, propertyName: string): string | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, propertyName)
  return typeof descriptor?.value === 'string' ? descriptor.value : null
}

export function parsePlanText(argsJson: string): string {
  try {
    const parsed: unknown = JSON.parse(argsJson)
    return getStringProperty(parsed, 'planText') ?? ''
  } catch {}
  return ''
}

export function parsePlanAction(content: unknown): 'approve' | 'revise' {
  try {
    const raw: unknown = typeof content === 'string' ? JSON.parse(content) : content
    const parsed = safeDecodeUnknown(planResponseSchema, raw)
    if (parsed.success) {
      return parsed.data.action
    }
  } catch {}
  return 'approve'
}

export function parseOrchestrateTasks(argsJson: string): OrchestrateTaskArg[] {
  try {
    const parsed: unknown = JSON.parse(argsJson)
    const taskList = getTasksProperty(parsed)
    if (taskList) {
      return taskList
    }
  } catch {}
  return []
}

export function isOrchestrateTaskArg(value: unknown): value is OrchestrateTaskArg {
  return getStringProperty(value, 'id') !== null && getStringProperty(value, 'title') !== null
}

export function getTasksProperty(value: unknown): OrchestrateTaskArg[] | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, 'tasks')
  if (!Array.isArray(descriptor?.value)) {
    return null
  }
  return descriptor.value.filter(isOrchestrateTaskArg).map((task) => ({
    id: task.id,
    title: task.title,
  }))
}
