import { safeDecodeUnknown } from '@shared/schema'
import { jsonValueSchema } from '@shared/schemas/validation'
import type { AgentSendPayload, InlineVisualizationContext } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { JsonValue } from '@shared/types/json'

const MAX_STATE_BYTES = 16 * 1024
const MAX_STATE_DEPTH = 20
const MAX_STATE_NODES = 2_000

interface MountedVisualizationState extends InlineVisualizationContext {
  readonly instanceId: string
  readonly sessionId: SessionId
  readonly sequence: number
}

const mountedStates = new Map<string, MountedVisualizationState>()
let sequence = 0

function hasBoundedJsonShape(value: unknown) {
  const pending: Array<{ readonly depth: number; readonly value: unknown }> = [{ depth: 0, value }]
  const seen = new WeakSet<object>()
  let nodes = 0

  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) break
    nodes += 1
    if (nodes > MAX_STATE_NODES || current.depth > MAX_STATE_DEPTH) return false
    if (
      current.value === null ||
      typeof current.value === 'string' ||
      typeof current.value === 'boolean' ||
      (typeof current.value === 'number' && Number.isFinite(current.value))
    ) {
      continue
    }
    if (typeof current.value !== 'object' || seen.has(current.value)) return false
    seen.add(current.value)
    const children = Array.isArray(current.value) ? current.value : Object.values(current.value)
    for (const child of children) pending.push({ depth: current.depth + 1, value: child })
  }

  return true
}

export function decodeInlineVisualizationState(value: unknown): JsonValue | null {
  if (!hasBoundedJsonShape(value)) return null
  const decoded = safeDecodeUnknown(jsonValueSchema, value)
  if (!decoded.success) return null
  const serialized = JSON.stringify(decoded.data)
  if (new TextEncoder().encode(serialized).byteLength > MAX_STATE_BYTES) return null
  return decoded.data
}

export function reportInlineVisualizationState(input: {
  readonly instanceId: string
  readonly sessionId: SessionId
  readonly sourcePath: string
  readonly title: string
  readonly state: JsonValue
}) {
  sequence += 1
  mountedStates.set(input.instanceId, { ...input, sequence })
}

export function clearInlineVisualizationState(instanceId: string) {
  mountedStates.delete(instanceId)
}

export function latestInlineVisualizationContext(
  sessionId: SessionId,
): InlineVisualizationContext | null {
  let latest: MountedVisualizationState | null = null
  for (const value of mountedStates.values()) {
    if (value.sessionId !== sessionId || (latest && value.sequence <= latest.sequence)) continue
    latest = value
  }
  if (!latest) return null
  return { title: latest.title, sourcePath: latest.sourcePath, state: latest.state }
}

export function withInlineVisualizationContext(
  sessionId: SessionId,
  payload: AgentSendPayload,
): AgentSendPayload {
  if (payload.visualizationContext) return payload
  const visualizationContext = latestInlineVisualizationContext(sessionId)
  return visualizationContext ? { ...payload, visualizationContext } : payload
}

export function clearInlineVisualizationStatesForTests() {
  mountedStates.clear()
  sequence = 0
}
