import type { ToolCallResult } from '@shared/types/tools'
import { isRecord } from '@shared/utils/validation'

const MAX_ORCHESTRATION_CHILD_TOOLS = 128

export interface CapturedToolOutputGroup {
  readonly label: string
  readonly result: unknown
}

export interface CapturedOrchestrationTool extends CapturedToolOutputGroup {
  readonly canonicalKey: string
  readonly occurrenceKey: string
}

function orchestrationChildren(value: unknown): readonly unknown[] {
  if (!isRecord(value)) return []
  const details = value.kind === 'orchestration' ? value : value.details
  return isRecord(details) && details.kind === 'orchestration' && Array.isArray(details.result)
    ? details.result
    : []
}

function capturedOrchestrationTool(
  candidate: unknown,
  index: number,
  toolResult: ToolCallResult,
): CapturedOrchestrationTool | null {
  if (
    !isRecord(candidate) ||
    candidate.status !== 'completed' ||
    typeof candidate.id !== 'string' ||
    !isRecord(candidate.provenance)
  ) {
    return null
  }
  const { serverInstanceId, serverLabel, toolName } = candidate.provenance
  if (
    typeof serverInstanceId !== 'string' ||
    typeof serverLabel !== 'string' ||
    typeof toolName !== 'string'
  ) {
    return null
  }
  const normalizedServerId = serverInstanceId.trim()
  const normalizedServerLabel = serverLabel.trim()
  const normalizedToolName = toolName.trim()
  if (!normalizedServerId || !normalizedServerLabel || !normalizedToolName) return null
  return {
    canonicalKey: `tool:${normalizedServerId}:${normalizedToolName}`,
    occurrenceKey: `read:tool:${String(toolResult.id)}:child:${String(index)}:${candidate.id}`,
    label: `${normalizedToolName} · ${normalizedServerLabel}`,
    result: candidate.result ?? null,
  }
}

export function capturedOrchestrationTools(
  toolResult: ToolCallResult,
): readonly CapturedOrchestrationTool[] {
  const candidates = orchestrationChildren(toolResult.details)
  const fallbackCandidates =
    candidates.length > 0 ? candidates : orchestrationChildren(toolResult.result)
  const captured: CapturedOrchestrationTool[] = []
  for (const [index, candidate] of fallbackCandidates.entries()) {
    if (captured.length >= MAX_ORCHESTRATION_CHILD_TOOLS) break
    const tool = capturedOrchestrationTool(candidate, index, toolResult)
    if (tool) captured.push(tool)
  }
  return captured
}
