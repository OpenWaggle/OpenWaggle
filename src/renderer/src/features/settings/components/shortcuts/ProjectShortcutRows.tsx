import type { ProjectActionShortcutRule } from '@shared/types/project-actions'
import { type ShortcutBinding, shortcutBindingKey } from '@shared/types/shortcuts'
import {
  parseProjectActionWhenExpression,
  projectActionShortcutRules,
} from '@shared/utils/project-action-shortcuts'
import { AlertTriangle, Trash2, X } from 'lucide-react'
import { type KeyboardEvent, useState } from 'react'
import {
  ProjectActionConditionBuilder,
  projectActionUnknownWhenVariables,
} from '@/features/project-actions'
import { Button } from '@/shared/ui/Button'
import {
  type ProjectShortcutBrowserRow,
  type ShortcutBrowserRow,
  shortcutBrowserConflictLabels,
} from '../../lib/shortcut-browser-model'
import type { UpdateProjectShortcutRules } from './AddShortcutBinding'
import {
  isShortcutModifierKey,
  ShortcutBindingButton,
  ShortcutConflictNotice,
  ShortcutSourceBadge,
  shortcutBindingFromEvent,
} from './ShortcutRowParts'

export type { UpdateProjectShortcutRules } from './AddShortcutBinding'
export { AddShortcutBinding } from './AddShortcutBinding'

interface ProjectShortcutRowProps {
  readonly row: ProjectShortcutBrowserRow
  readonly rows: readonly ShortcutBrowserRow[]
  readonly saving: boolean
  readonly onError: (message: string | null) => void
  readonly onUpdate: UpdateProjectShortcutRules
}

function ProjectShortcutMetadata(props: {
  readonly row: ProjectShortcutBrowserRow
  readonly unknownVariables: readonly string[]
}) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-medium text-text-primary">{props.row.label}</h3>
        <ShortcutSourceBadge source="Project" />
        {props.unknownVariables.length > 0 ? (
          <span
            role="img"
            className="inline-flex text-warning"
            title={`Unknown contexts evaluate to false: ${props.unknownVariables.join(', ')}`}
            aria-label={`Unknown conditions ${props.unknownVariables.join(', ')}`}
          >
            <AlertTriangle className="size-3.5" />
          </span>
        ) : null}
      </div>
      <p className="truncate font-mono text-xs text-text-tertiary" title={props.row.description}>
        {props.row.description}
      </p>
      <div className="font-mono text-xs text-text-muted">{props.row.command}</div>
    </div>
  )
}

function ProjectShortcutCondition(props: {
  readonly label: string
  readonly value: string
  readonly normalizedValue: string
  readonly onChange: (value: string) => void
}) {
  return (
    <details className="group rounded-md border border-border bg-bg">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs text-text-secondary">
        <span>
          When{' '}
          <code className="font-mono text-text-primary">{props.normalizedValue || 'Always'}</code>
        </span>
        <span className="text-text-muted group-open:hidden">Edit condition</span>
      </summary>
      <div className="border-t border-border p-3">
        <ProjectActionConditionBuilder
          value={props.value}
          expressionLabel={`When expression for ${props.label}`}
          onChange={props.onChange}
        />
      </div>
    </details>
  )
}

export function ProjectShortcutRow({
  row,
  rows,
  saving,
  onError,
  onUpdate,
}: ProjectShortcutRowProps) {
  const [binding, setBinding] = useState<ShortcutBinding>(row.binding)
  const [when, setWhen] = useState(row.when)
  const [recording, setRecording] = useState(false)
  const persistedKey = shortcutBindingKey(row.binding)
  const normalizedWhen = when.trim()
  const whenIsValid =
    normalizedWhen.length === 0 || parseProjectActionWhenExpression(normalizedWhen) !== null
  const dirty = shortcutBindingKey(binding) !== persistedKey || normalizedWhen !== row.when
  const conflicts = shortcutBrowserConflictLabels(rows, {
    rowId: row.id,
    binding,
    when: normalizedWhen,
  })
  const unknownVariables = projectActionUnknownWhenVariables(normalizedWhen)

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!recording) return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      setBinding(row.binding)
      setRecording(false)
      return
    }
    const next = shortcutBindingFromEvent(event)
    if (next === null) {
      if (!isShortcutModifierKey(event.key)) {
        onError('Use Command, Control, Alt, or Shift with the key.')
      }
      return
    }
    setBinding(next)
    setRecording(false)
    onError(null)
  }

  async function save() {
    const nextRule: ProjectActionShortcutRule = {
      shortcut: binding,
      ...(normalizedWhen.length > 0 ? { when: normalizedWhen } : {}),
    }
    const nextRules = projectActionShortcutRules(row.action).map((rule, index) =>
      index === row.ruleIndex ? nextRule : rule,
    )
    await onUpdate(row.action.id, nextRules)
  }

  async function remove() {
    const nextRules = projectActionShortcutRules(row.action).filter(
      (_rule, index) => index !== row.ruleIndex,
    )
    await onUpdate(row.action.id, nextRules)
  }

  return (
    <article className="space-y-3 px-4 py-3.5">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <ProjectShortcutMetadata row={row} unknownVariables={unknownVariables} />
        <div className="flex items-center justify-end gap-2">
          {dirty ? (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                title="Discard changes"
                aria-label={`Discard changes to ${row.label}`}
                onClick={() => {
                  setBinding(row.binding)
                  setWhen(row.when)
                }}
              >
                <X className="size-3" />
              </Button>
              <Button
                variant="accent"
                size="xs"
                disabled={saving || !whenIsValid}
                onClick={() => void save()}
              >
                Save
              </Button>
            </>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            title="Remove binding"
            aria-label={`Remove binding for ${row.label}`}
            disabled={saving}
            onClick={() => void remove()}
          >
            <Trash2 className="size-3" />
          </Button>
          <ShortcutBindingButton
            label={`Change project binding ${row.label}`}
            binding={binding}
            recording={recording}
            disabled={saving}
            onClick={() => {
              setRecording(true)
              onError(null)
            }}
            onKeyDown={handleKeyDown}
          />
        </div>
      </div>
      <ProjectShortcutCondition
        label={row.label}
        value={when}
        normalizedValue={normalizedWhen}
        onChange={setWhen}
      />
      <ShortcutConflictNotice labels={conflicts} />
    </article>
  )
}
