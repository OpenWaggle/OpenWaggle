import type { ScheduledTask } from '@shared/types/scheduled-task'
import { ArrowLeft, Plus } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { useFullscreen } from '@/shell/useFullscreen'
import type { ScheduledTaskEditorTarget } from '../hooks/useScheduledTaskEditor'
import { BackgroundStartOffer } from './BackgroundStartOffer'
import { ScheduledTaskDetail } from './ScheduledTaskDetail'
import { ScheduledTaskEditorDialog } from './ScheduledTaskEditorDialog'
import { ScheduledTaskList } from './ScheduledTaskList'

interface ScheduledTasksPageProps {
  /** The task whose detail and history are open, from the route search. */
  readonly selectedTaskId: string | null
  readonly onSelectTask: (taskId: string | null) => void
  /** Leaves the full-page view; the shell hides the sidebar and header on this route. */
  readonly onBack: () => void
}

/** Mirrors the Usage & Cost top bar: window drag region, traffic-light inset, a way back. */
function ScheduledTasksTopBar({
  onBack,
  onCreate,
}: {
  readonly onBack: () => void
  readonly onCreate: () => void
}) {
  const isFullscreen = useFullscreen()
  return (
    <div
      className={cn(
        'drag-region flex h-12 shrink-0 items-center gap-3 border-b border-border px-4',
        !isFullscreen && 'pl-20',
      )}
    >
      <Button
        variant="unstyled"
        onClick={onBack}
        className="no-drag flex items-center gap-2 rounded-md px-2 py-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
      >
        <ArrowLeft className="size-4" />
        <span className="text-xs">Back to app</span>
      </Button>
      <h1 className="no-drag text-base font-medium text-text-primary">Scheduled tasks</h1>
      <Button
        variant="secondary"
        size="xs"
        className="no-drag ml-auto"
        leftIcon={<Plus className="size-3" />}
        onClick={onCreate}
      >
        New task
      </Button>
    </div>
  )
}

/** The Scheduled tasks page (CONTEXT.md): every task by project, and each one's history. */
export function ScheduledTasksPage({
  selectedTaskId,
  onSelectTask,
  onBack,
}: ScheduledTasksPageProps) {
  const [editor, setEditor] = useState<ScheduledTaskEditorTarget | null>(null)
  const edit = (task: ScheduledTask) => setEditor({ mode: 'edit', task })
  const create = () => setEditor({ mode: 'create' })

  return (
    <div className="flex size-full flex-col bg-bg">
      <ScheduledTasksTopBar onBack={onBack} onCreate={create} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6">
          <BackgroundStartOffer />
          {selectedTaskId ? (
            <ScheduledTaskDetail
              taskId={selectedTaskId}
              onBack={() => onSelectTask(null)}
              onEdit={edit}
            />
          ) : (
            <ScheduledTaskList onSelect={onSelectTask} onEdit={edit} onCreate={create} />
          )}
        </div>
      </div>
      {editor ? (
        <ScheduledTaskEditorDialog
          target={editor}
          onClose={() => setEditor(null)}
          onSaved={(task, created) => {
            if (created) onSelectTask(task.id)
          }}
        />
      ) : null}
    </div>
  )
}
