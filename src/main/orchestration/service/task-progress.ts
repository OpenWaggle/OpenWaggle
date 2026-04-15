import { TIME_UNIT } from '@shared/constants/time'
import { safeDecodeUnknown } from '@shared/schema'
import { taskToolProgressSchema } from '@shared/schemas/validation'
import type { OrchestrationProgressPayload } from '../engine'
import type { PlannedTask } from './planner'
import { formatToolActivity } from './tool-activity'

const RECORD_TASK_OUTPUT_VALUE_4 = 4

export class TaskProgressTracker {
  private readonly now: () => number
  private readonly taskNarrations = new Map<string, string>()
  private readonly taskTitles = new Map<string, string>()
  private readonly taskKinds = new Map<string, string>()
  private readonly taskStartTimes = new Map<string, number>()
  private readonly taskFileCount = new Map<string, number>()
  private readonly taskTokens = new Map<string, number>()

  constructor(tasks: readonly PlannedTask[], now: () => number) {
    this.now = now
    for (const task of tasks) {
      if (task.narration) {
        this.taskNarrations.set(task.id, task.narration)
      }
      this.taskTitles.set(task.id, task.title ?? task.id)
      if (task.kind) {
        this.taskKinds.set(task.id, task.kind)
      }
    }
  }

  onTaskStarted(taskId: string): string | null {
    this.taskStartTimes.set(taskId, this.now())
    return this.taskNarrations.get(taskId) ?? null
  }

  onTaskProgress(taskId: string, payload: OrchestrationProgressPayload): string | null {
    const progressResult = safeDecodeUnknown(taskToolProgressSchema, payload)
    if (!progressResult.success || progressResult.data.type !== 'tool_end') {
      return null
    }
    const line = formatToolActivity(progressResult.data.toolName, progressResult.data.toolInput)
    if (!line) {
      return null
    }
    const fileCount = this.taskFileCount.get(taskId) ?? 0
    this.taskFileCount.set(taskId, fileCount + 1)
    return line
  }

  recordTaskOutput(taskId: string, text: string): void {
    this.taskTokens.set(taskId, Math.ceil(text.length / RECORD_TASK_OUTPUT_VALUE_4))
  }

  onTaskSucceeded(taskId: string): string {
    const title = this.taskTitles.get(taskId) ?? taskId
    const files = this.taskFileCount.get(taskId) ?? 0
    const tokens = this.taskTokens.get(taskId) ?? 0
    const startedAt = this.taskStartTimes.get(taskId) ?? this.now()
    const elapsed = ((this.now() - startedAt) / TIME_UNIT.MILLISECONDS_PER_SECOND).toFixed(1)

    const parts: string[] = []
    if (files > 0) parts.push(`${String(files)} files`)
    if (tokens > 0) parts.push(`~${String(tokens)} output tokens`)
    parts.push(`${elapsed}s`)

    return `✓ ${title} — ${parts.join(', ')}`
  }

  getTaskTitle(taskId: string): string | undefined {
    return this.taskTitles.get(taskId)
  }

  getTaskKind(taskId: string): string | undefined {
    return this.taskKinds.get(taskId)
  }
}
