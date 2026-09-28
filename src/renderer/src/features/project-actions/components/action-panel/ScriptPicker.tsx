import type { DiscoveredProjectTask, ProjectTaskReference } from '@shared/types/action-definitions'
import { Check, Search } from 'lucide-react'
import { type Ref, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { TextInput } from '@/shared/ui/TextInput'
import {
  filterScripts,
  packageLabel,
  rankScripts,
  sameTaskReference,
  taskReferenceKey,
} from '../../lib/action-panel-scripts'

const COLLAPSED_SCRIPT_COUNT = 6

interface ScriptPickerProps {
  readonly rootRef?: Ref<HTMLDivElement>
  readonly tasks: readonly DiscoveredProjectTask[]
  readonly selected: ProjectTaskReference | null
  readonly status: 'loading' | 'error' | 'ready'
  readonly onPick: (task: DiscoveredProjectTask) => void
  readonly onRetry: () => void
}

/** A roomy script list: the common scripts first, the rest behind "Show all" or a search. */
export function ScriptPicker(props: ScriptPickerProps) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const ranked = rankScripts(props.tasks)
  const matches = filterScripts(ranked, query)
  const showingAll = expanded || query.trim().length > 0
  const visible = showingAll ? matches : matches.slice(0, COLLAPSED_SCRIPT_COUNT)
  if (props.status === 'loading')
    return (
      <p role="status" className="text-sm text-text-tertiary">
        Looking for scripts in this project…
      </p>
    )
  if (props.status === 'error')
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm text-error-text">
        <span role="alert">
          Could not read this project’s scripts. You can type a command instead.
        </span>
        <Button variant="ghost" size="xs" onClick={props.onRetry}>
          Try again
        </Button>
      </div>
    )
  if (ranked.length === 0)
    return (
      <p className="text-sm text-text-tertiary">
        No scripts found in this project. Type a command instead.
      </p>
    )
  return (
    <div ref={props.rootRef} className="grid min-w-0 grid-cols-1 gap-2.5">
      {ranked.length > COLLAPSED_SCRIPT_COUNT ? (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-text-tertiary" />
          <TextInput
            aria-label="Search scripts"
            className="py-2.5 pl-10"
            placeholder={`Search ${String(ranked.length)} scripts by name or command`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      ) : null}
      {query && matches.length === 0 ? (
        <p className="text-sm text-text-tertiary">No script matches that search.</p>
      ) : null}
      <ul
        aria-label="Project scripts"
        className={cn('grid min-w-0 grid-cols-1 gap-0.5', showingAll && 'max-h-80 overflow-y-auto')}
      >
        {visible.map((task) => (
          <li key={taskReferenceKey(task.reference)} className="min-w-0">
            <ScriptRow
              task={task}
              selected={
                props.selected !== null && sameTaskReference(props.selected, task.reference)
              }
              onPick={() => props.onPick(task)}
            />
          </li>
        ))}
      </ul>
      {!query && matches.length > COLLAPSED_SCRIPT_COUNT ? (
        <Button
          variant="ghost"
          size="sm"
          className="justify-self-start"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show fewer' : `Show all ${String(matches.length)} scripts`}
        </Button>
      ) : null}
    </div>
  )
}

function ScriptRow(props: {
  readonly task: DiscoveredProjectTask
  readonly selected: boolean
  readonly onPick: () => void
}) {
  const { task } = props
  const where = packageLabel(task.reference)
  return (
    <Button
      variant="unstyled"
      aria-pressed={props.selected}
      disabled={Boolean(task.unavailableReason)}
      title={task.unavailableReason ?? task.description}
      className={cn(
        'flex w-full min-w-0 items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
        props.selected ? 'bg-accent/7 ring-1 ring-accent/45 ring-inset' : 'hover:bg-bg-hover',
      )}
      onClick={props.onPick}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-sm text-text-primary">
          {task.reference.task}
        </span>
        <span className="mt-0.5 block truncate font-mono text-xs text-text-tertiary">
          {task.unavailableReason ?? task.description}
        </span>
      </span>
      {where ? (
        <span className="shrink-0 text-xs text-text-tertiary @max-md:hidden">{where}</span>
      ) : null}
      {props.selected ? <Check aria-hidden className="size-4 shrink-0 text-accent" /> : null}
    </Button>
  )
}
