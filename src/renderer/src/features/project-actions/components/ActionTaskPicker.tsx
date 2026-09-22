import type { ActionInvocation } from '@shared/types/action-definitions'
import type { ActionManagementScope } from '@shared/types/action-management'
import { Search } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { TextInput } from '@/shared/ui/TextInput'
import { useActionDiscovery } from '../hooks/useNativeActions'

const TASK_SEARCH_THRESHOLD = 6
export function ActionTaskPicker({
  scope,
  onChoose,
}: {
  readonly scope: ActionManagementScope
  readonly onChoose: (invocation: ActionInvocation, name: string) => void
}) {
  const discovery = useActionDiscovery(scope)
  const [search, setSearch] = useState('')
  const allTasks = discovery.data?.tasks ?? []
  const tasks = allTasks.filter((task) =>
    `${task.group} ${task.reference.source} ${task.reference.task} ${task.description}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  )
  return (
    <section aria-label="Detected project scripts" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-text-secondary">Use a project script</h3>
        <Button
          variant="ghost"
          size="xs"
          disabled={discovery.isFetching}
          onClick={() => void discovery.refetch()}
        >
          {discovery.error ? 'Retry' : 'Refresh'}
        </Button>
      </div>
      {allTasks.length > TASK_SEARCH_THRESHOLD || search.length > 0 ? (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3 size-4 text-text-tertiary" />
          <TextInput
            aria-label="Filter project scripts"
            className="pl-9"
            placeholder="Filter detected scripts…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      ) : null}
      {discovery.isPending ? (
        <p role="status" className="text-xs text-text-tertiary">
          Reading project scripts… You can enter a command below.
        </p>
      ) : null}
      {discovery.error ? (
        <p role="alert" className="text-xs text-error-text">
          Could not read project scripts. You can enter a command below. {discovery.error.message}
        </p>
      ) : null}
      {tasks.length > 0 ? (
        <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
          {tasks.map((task) => (
            <Button
              key={JSON.stringify(task.reference)}
              variant="secondary"
              size="sm"
              className="h-auto min-h-9 max-w-full flex-wrap justify-start text-left"
              disabled={Boolean(task.unavailableReason)}
              title={task.unavailableReason ?? task.description}
              aria-label={`${task.reference.task} · ${task.group} · ${task.description}`}
              onClick={() => onChoose({ type: 'task', task: task.reference }, task.reference.task)}
            >
              <span className="break-all">{task.reference.task}</span>
              <span className="break-all text-xs font-normal text-text-tertiary">
                {task.group} · {task.reference.source}
              </span>
            </Button>
          ))}
        </div>
      ) : null}
      {!discovery.isPending && !discovery.error && tasks.length === 0 ? (
        <p className="text-xs text-text-tertiary">
          {allTasks.length
            ? 'No scripts match your filter.'
            : 'No scripts detected. Enter a command below.'}
        </p>
      ) : null}
      {discovery.data?.diagnostics.map((diagnostic) => (
        <p
          key={`${diagnostic.source}:${diagnostic.message}`}
          className="break-words text-xs text-text-tertiary"
        >
          {diagnostic.source}: {diagnostic.message}
        </p>
      ))}
    </section>
  )
}
