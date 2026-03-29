import type { ConversationId } from '@shared/types/brand'
import type { OrchestrationEventPayload } from '@shared/types/orchestration'
import type { AgentPhaseLabel, AgentPhaseState } from '@shared/types/phase'
import type { AgentStreamChunk } from '@shared/types/stream'

interface TaskPhaseState {
  status: 'queued' | 'running' | 'retrying' | 'completed' | 'failed' | 'cancelled'
  kind: string
}

interface ConversationPhaseState {
  current: AgentPhaseState | null
  mode: 'classic' | 'orchestration'
  runStatus: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'
  tasks: Map<string, TaskPhaseState>
}

interface PhaseChangeResult {
  readonly changed: boolean
  readonly phase: AgentPhaseState | null
}

const KIND_TO_LABEL: Record<string, AgentPhaseLabel> = {
  analysis: 'Researching',
  debugging: 'Debugging',
  refactoring: 'Refactoring',
  testing: 'Testing',
  documentation: 'Documenting',
  'repo-edit': 'Editing',
  general: 'Executing',
}

// Higher index = higher priority when multiple tasks run concurrently.
const KIND_PRIORITY: readonly string[] = [
  'general',
  'documentation',
  'analysis',
  'testing',
  'refactoring',
  'debugging',
  'repo-edit',
]

const TERMINAL_TASK_STATUSES: ReadonlySet<TaskPhaseState['status']> = new Set([
  'completed',
  'failed',
  'cancelled',
])

const states = new Map<string, ConversationPhaseState>()

function getState(conversationId: ConversationId): ConversationPhaseState {
  const key = String(conversationId)
  const existing = states.get(key)
  if (existing) return existing

  const created: ConversationPhaseState = {
    current: null,
    mode: 'classic',
    runStatus: 'idle',
    tasks: new Map(),
  }
  states.set(key, created)
  return created
}

function setPhase(
  state: ConversationPhaseState,
  label: AgentPhaseLabel,
  startedAt: number,
): PhaseChangeResult {
  const next: AgentPhaseState = { label, startedAt }
  if (state.current && state.current.label === next.label) {
    return { changed: false, phase: state.current }
  }
  state.current = next
  return { changed: true, phase: next }
}

function clearPhase(conversationId: ConversationId): PhaseChangeResult {
  const key = String(conversationId)
  const state = states.get(key)
  if (!state) {
    return { changed: false, phase: null }
  }

  const changed = state.current !== null
  states.delete(key)
  return { changed, phase: null }
}

function recomputeOrchestrationLabel(state: ConversationPhaseState): AgentPhaseLabel {
  const tasks = [...state.tasks.values()]
  if (tasks.length === 0) return 'Planning'

  const allQueued = tasks.every((task) => task.status === 'queued')
  if (allQueued) return 'Planning'

  const allTerminal = tasks.every((task) => TERMINAL_TASK_STATUSES.has(task.status))
  if (allTerminal) return 'Reviewing'

  const activeTasks = tasks.filter(
    (task) => task.status === 'running' || task.status === 'retrying',
  )
  if (activeTasks.length === 0) return 'Executing'

  let bestKind = 'general'
  let bestPriority = -1
  for (const task of activeTasks) {
    const kind = task.kind || 'general'
    const priority = KIND_PRIORITY.indexOf(kind)
    if (priority > bestPriority) {
      bestPriority = priority
      bestKind = kind
    }
  }

  return KIND_TO_LABEL[bestKind] ?? 'Executing'
}

export function updatePhaseFromStreamChunk(
  conversationId: ConversationId,
  chunk: AgentStreamChunk,
  now: number,
): PhaseChangeResult {
  const state = getState(conversationId)

  if (chunk.type === 'RUN_STARTED') {
    state.mode = 'classic'
    state.runStatus = 'running'
    state.tasks.clear()
    return setPhase(state, 'Thinking', now)
  }

  if (chunk.type === 'TEXT_MESSAGE_CONTENT') {
    if (state.mode === 'orchestration') {
      return { changed: false, phase: state.current }
    }
    if (state.runStatus !== 'running') {
      return { changed: false, phase: state.current }
    }
    return setPhase(state, 'Writing', now)
  }

  if (chunk.type === 'TOOL_CALL_START') {
    if (state.mode === 'orchestration') {
      return { changed: false, phase: state.current }
    }
    return setPhase(state, 'Thinking', now)
  }

  if (chunk.type === 'RUN_ERROR') {
    return clearPhase(conversationId)
  }

  if (chunk.type === 'RUN_FINISHED' && chunk.finishReason !== 'tool_calls') {
    return clearPhase(conversationId)
  }

  return { changed: false, phase: state.current }
}

export function updatePhaseFromOrchestrationEvent(
  payload: OrchestrationEventPayload,
  now: number,
): PhaseChangeResult {
  const state = getState(payload.conversationId)
  state.mode = 'orchestration'

  if (payload.type === 'run_started') {
    state.runStatus = 'running'
    state.tasks.clear()
    return setPhase(state, 'Planning', now)
  }

  if (payload.type === 'run_completed') {
    state.runStatus = 'completed'
    return setPhase(state, 'Reviewing', now)
  }

  if (payload.type === 'run_failed') {
    state.runStatus = 'failed'
    return setPhase(state, 'Reviewing', now)
  }

  if (payload.type === 'run_cancelled') {
    state.runStatus = 'cancelled'
    return setPhase(state, 'Reviewing', now)
  }

  if (payload.type === 'fallback') {
    state.mode = 'classic'
    return setPhase(state, 'Thinking', now)
  }

  if (!payload.taskId) {
    return { changed: false, phase: state.current }
  }

  const taskId = String(payload.taskId)
  const existing = state.tasks.get(taskId) ?? {
    status: 'queued',
    kind: 'general',
  }

  const kind = payload.taskKind ?? existing.kind

  if (payload.type === 'task_queued') {
    state.tasks.set(taskId, { status: 'queued', kind })
  }

  if (payload.type === 'task_started') {
    state.tasks.set(taskId, { status: 'running', kind })
  }

  if (payload.type === 'task_retried') {
    state.tasks.set(taskId, { status: 'retrying', kind })
  }

  if (payload.type === 'task_succeeded') {
    state.tasks.set(taskId, { status: 'completed', kind })
  }

  if (payload.type === 'task_failed') {
    state.tasks.set(taskId, { status: 'failed', kind })
  }

  state.runStatus = 'running'
  return setPhase(state, recomputeOrchestrationLabel(state), now)
}

export function resetPhaseForConversation(conversationId: ConversationId): PhaseChangeResult {
  return clearPhase(conversationId)
}

export function getPhaseForConversation(conversationId: ConversationId): AgentPhaseState | null {
  const state = states.get(String(conversationId))
  return state?.current ?? null
}
