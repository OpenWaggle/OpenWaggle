import type { ScheduledTask, ScheduledTaskKind } from '@shared/types/scheduled-task'
import { useState } from 'react'
import type { ScheduleDraft } from '../lib/schedule-presets'
import {
  draftFromTask,
  newTaskDraft,
  type TaskEditorDraft,
  taskInputFromDraft,
  taskPatchFromDraft,
  withDraftKind,
} from '../lib/task-draft'
import { machineTimeZone } from '../lib/task-format'
import { useCreateScheduledTask, useUpdateScheduledTask } from './useScheduledTaskMutations'

export type ScheduledTaskEditorTarget =
  | {
      readonly mode: 'create'
      readonly kind?: ScheduledTaskKind
      readonly sessionId?: string
      readonly projectPath?: string
    }
  | { readonly mode: 'edit'; readonly task: ScheduledTask }

function initialDraft(target: ScheduledTaskEditorTarget) {
  if (target.mode === 'edit') return draftFromTask(target.task)
  return newTaskDraft({
    kind: target.kind ?? (target.sessionId ? 'heartbeat' : 'launch'),
    timeZone: machineTimeZone(),
    ...(target.sessionId ? { sessionId: target.sessionId } : {}),
    ...(target.projectPath ? { projectPath: target.projectPath } : {}),
  })
}

/**
 * Create/Edit editor state. Local validation catches what the form can know; the Host's own
 * rejection (an invalid rule, a missing capability) is shown inline as it was worded.
 */
export function useScheduledTaskEditor(
  target: ScheduledTaskEditorTarget,
  onSaved: (task: ScheduledTask, created: boolean) => void,
) {
  const [draft, setDraft] = useState<TaskEditorDraft>(() => initialDraft(target))
  const [validationError, setValidationError] = useState<string | null>(null)
  const create = useCreateScheduledTask()
  const update = useUpdateScheduledTask()
  const mutation = target.mode === 'edit' ? update : create

  const change = (patch: Partial<TaskEditorDraft>) => {
    setValidationError(null)
    setDraft((current) => ({ ...current, ...patch }))
  }
  const changeSchedule = (patch: Partial<ScheduleDraft>) => {
    setValidationError(null)
    setDraft((current) => ({ ...current, schedule: { ...current.schedule, ...patch } }))
  }
  const changeKind = (kind: ScheduledTaskKind) => {
    setValidationError(null)
    setDraft((current) => withDraftKind(current, kind))
  }

  const submit = () => {
    if (target.mode === 'edit') {
      const patch = taskPatchFromDraft(draft)
      if (!patch.ok) {
        setValidationError(patch.error)
        return
      }
      update.mutate(
        { taskId: target.task.id, patch: patch.value },
        { onSuccess: (task) => onSaved(task, false) },
      )
      return
    }
    const input = taskInputFromDraft(draft)
    if (!input.ok) {
      setValidationError(input.error)
      return
    }
    create.mutate(input.value, { onSuccess: (task) => onSaved(task, true) })
  }

  const hostError = mutation.error instanceof Error ? mutation.error.message : null
  return {
    draft,
    isEdit: target.mode === 'edit',
    original: target.mode === 'edit' ? target.task : null,
    change,
    changeSchedule,
    changeKind,
    submit,
    isSaving: mutation.isPending,
    error: validationError ?? hostError,
  }
}

export type ScheduledTaskEditorState = ReturnType<typeof useScheduledTaskEditor>
