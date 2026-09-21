import type { ActionInvocation } from '@shared/types/action-definitions'
import type { ActionManagementScope } from '@shared/types/action-management'
import { ArrowRight, Search, Terminal } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { TextInput } from '@/shared/ui/TextInput'
import { useActionDiscovery } from '../hooks/useNativeActions'

export function ActionTaskPicker({
  scope,
  onChoose,
}: {
  readonly scope: ActionManagementScope
  readonly onChoose: (invocation: ActionInvocation, name: string) => void
}) {
  const discovery = useActionDiscovery(scope)
  const [search, setSearch] = useState('')
  const tasks = (discovery.data?.tasks ?? []).filter((task) =>
    `${task.group} ${task.reference.task} ${task.description}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  )
  return (
    <div className="space-y-4 p-5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-3 size-4 text-text-tertiary" />
        <TextInput
          aria-label="Find a project task"
          className="pl-9"
          placeholder="Find a task in this project…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <Button
        variant="row"
        className="min-h-12 gap-3 rounded-lg border border-border p-3"
        onClick={() => onChoose({ type: 'command', command: '', directory: '.' }, '')}
      >
        <Terminal className="size-4" />
        <span className="flex-1">Write a custom command</span>
        <ArrowRight className="size-4" />
      </Button>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-text-secondary">Tasks from your project</h3>
        <Button variant="ghost" size="xs" onClick={() => void discovery.refetch()}>
          Refresh
        </Button>
      </div>
      {discovery.isPending ? (
        <p className="text-sm text-text-tertiary">Reading project task files…</p>
      ) : null}
      {discovery.error ? (
        <p role="alert" className="text-xs text-error-text">
          {discovery.error.message}
        </p>
      ) : null}
      <div className="max-h-80 overflow-y-auto rounded-lg border border-border divide-y divide-border">
        {tasks.map((task) => (
          <Button
            key={JSON.stringify(task.reference)}
            variant="row"
            className="min-h-14 items-start gap-3 rounded-none px-3 py-3"
            disabled={Boolean(task.unavailableReason)}
            onClick={() => onChoose({ type: 'task', task: task.reference }, task.reference.task)}
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <strong className="text-sm font-medium text-text-primary">
                  {task.reference.task}
                </strong>
                <span className="truncate text-xs text-text-tertiary">{task.group}</span>
              </span>
              <span className="mt-1 block truncate font-mono text-xs text-text-tertiary">
                {task.unavailableReason ?? task.description}
              </span>
            </span>
            <ArrowRight className="mt-1 size-3.5" />
          </Button>
        ))}
        {!discovery.isPending && tasks.length === 0 ? (
          <p className="p-4 text-sm text-text-tertiary">
            No matching tasks. You can add a custom command.
          </p>
        ) : null}
      </div>
      {discovery.data?.diagnostics.map((diagnostic) => (
        <p
          key={`${diagnostic.source}:${diagnostic.message}`}
          className="text-xs text-text-tertiary"
        >
          {diagnostic.source}: {diagnostic.message}
        </p>
      ))}
      <p className="text-xs leading-5 text-text-tertiary">
        Choosing a task saves a reference to its name. Future runs use the task in the selected
        workspace.
      </p>
    </div>
  )
}
