import type { ScheduledTask } from '@shared/types/scheduled-task'
import { useQuery } from '@tanstack/react-query'
import { scheduledTasksListQueryOptions } from '@/queries/scheduled-tasks'
import { Button } from '@/shared/ui/Button'
import type { ScheduledTaskEditorTarget } from '../hooks/useScheduledTaskEditor'
import {
  type ScheduledTasksContainer,
  type ScheduledTasksView,
  showScheduledTasksView,
} from '../state/scheduled-tasks-navigation-store'
import type { ScheduledTaskEditorLayout } from './EditorTargetFields'
import { ScheduledTaskDetail } from './ScheduledTaskDetail'
import { ScheduledTaskEditor } from './ScheduledTaskEditor'

function editorTarget(
  view: Extract<ScheduledTasksView, { kind: 'edit' | 'new' }>,
  tasks: readonly ScheduledTask[] | undefined,
): ScheduledTaskEditorTarget | null {
  if (view.kind === 'new') return { mode: 'create', ...view.defaults }
  const task = tasks?.find((candidate) => candidate.id === view.taskId)
  return task ? { mode: 'edit', task } : null
}

/** Remounts the editor, and so its draft, for another task or another New task's defaults. */
function editorKey(view: Extract<ScheduledTasksView, { kind: 'edit' | 'new' }>) {
  if (view.kind === 'edit') return `edit:${view.taskId}`
  const { kind, sessionId, projectPath } = view.defaults
  return `new:${kind ?? ''}:${sessionId ?? ''}:${projectPath ?? ''}`
}

/**
 * A task's detail, or the editor in its place, for one Scheduled tasks container. The Right
 * panel and Settings render the same body at their own width (CONTEXT.md, Scheduled tasks).
 */
export function ScheduledTasksViewBody({
  container,
  view,
  layout,
}: {
  readonly container: ScheduledTasksContainer
  readonly view: Exclude<ScheduledTasksView, { kind: 'list' }>
  readonly layout: ScheduledTaskEditorLayout
}) {
  const { data: tasks } = useQuery(scheduledTasksListQueryOptions())
  const show = (next: ScheduledTasksView) => showScheduledTasksView(container, next)

  if (view.kind === 'task') {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ScheduledTaskDetail
          taskId={view.taskId}
          layout={layout}
          onEdit={(task) => show({ kind: 'edit', taskId: task.id })}
          onDeleted={() => show({ kind: 'list' })}
        />
      </div>
    )
  }
  const target = editorTarget(view, tasks)
  if (!target) {
    // The list has not loaded yet, or the task was deleted while its editor was open.
    if (tasks === undefined) return null
    return (
      <div className="flex flex-col items-start gap-2 p-4 text-sm text-text-secondary">
        <p>This task no longer exists.</p>
        <Button variant="secondary" size="sm" onClick={() => show({ kind: 'list' })}>
          Back to Scheduled tasks
        </Button>
      </div>
    )
  }
  const previous: ScheduledTasksView =
    view.kind === 'edit' ? { kind: 'task', taskId: view.taskId } : { kind: 'list' }
  return (
    <ScheduledTaskEditor
      key={editorKey(view)}
      target={target}
      layout={layout}
      onCancel={() => show(previous)}
      onSaved={(task) => show({ kind: 'task', taskId: task.id })}
    />
  )
}
