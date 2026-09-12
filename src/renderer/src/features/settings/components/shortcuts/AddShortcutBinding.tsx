import type { ProjectAction, ProjectActionShortcutRule } from '@shared/types/project-actions'
import {
  SHORTCUT_DEFINITIONS,
  type ShortcutBinding,
  type ShortcutRule,
} from '@shared/types/shortcuts'
import {
  parseProjectActionWhenExpression,
  projectActionShortcutRules,
} from '@shared/utils/project-action-shortcuts'
import { X } from 'lucide-react'
import { type KeyboardEvent, useState } from 'react'
import { ProjectActionConditionBuilder } from '@/features/project-actions'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'
import {
  type ShortcutBrowserRow,
  shortcutBrowserConflictLabels,
} from '../../lib/shortcut-browser-model'
import {
  isShortcutModifierKey,
  ShortcutBindingButton,
  ShortcutConflictNotice,
  shortcutBindingFromEvent,
} from './ShortcutRowParts'

export type UpdateProjectShortcutRules = (
  actionId: string,
  rules: readonly ProjectActionShortcutRule[],
) => Promise<boolean>

interface AddShortcutBindingProps {
  readonly actions: readonly ProjectAction[]
  readonly rows: readonly ShortcutBrowserRow[]
  readonly saving: boolean
  readonly onClose: () => void
  readonly onError: (message: string | null) => void
  readonly onUpdate: UpdateProjectShortcutRules
  readonly onAddBuiltIn: (rule: ShortcutRule) => Promise<boolean>
}

function AddShortcutHeader({ onClose }: { readonly onClose: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <h3 id="add-shortcut-binding-heading" className="text-sm font-medium text-text-primary">
          Add keyboard binding
        </h3>
        <p className="mt-0.5 text-xs text-text-tertiary">
          Add another ordered rule for a built-in command or Project Action.
        </p>
      </div>
      <Button variant="ghost" size="icon-sm" aria-label="Close add binding" onClick={onClose}>
        <X className="size-3.5" />
      </Button>
    </div>
  )
}

function ShortcutTargetSelect({
  actions,
  target,
  onChange,
}: {
  readonly actions: readonly ProjectAction[]
  readonly target: string
  readonly onChange: (target: string) => void
}) {
  return (
    <div className="space-y-1.5 text-xs font-medium text-text-secondary">
      <label htmlFor="new-shortcut-command">Command</label>
      <Select
        id="new-shortcut-command"
        className="block w-full"
        aria-label="Command for new binding"
        value={target}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        <optgroup label="Built-in">
          {SHORTCUT_DEFINITIONS.map((definition) => (
            <option key={definition.command} value={`builtin:${definition.command}`}>
              {definition.label}
            </option>
          ))}
        </optgroup>
        {actions.length > 0 ? (
          <optgroup label="Project Actions">
            {actions.map((action) => (
              <option key={action.id} value={`project:${action.id}`}>
                {action.name}
              </option>
            ))}
          </optgroup>
        ) : null}
      </Select>
    </div>
  )
}

function AddShortcutFooter(props: {
  readonly canSave: boolean
  readonly saving: boolean
  readonly onClose: () => void
  readonly onSave: () => void
}) {
  return (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" size="xs" onClick={props.onClose}>
        Cancel
      </Button>
      <Button variant="accent" size="xs" disabled={!props.canSave} onClick={props.onSave}>
        {props.saving ? 'Saving…' : 'Add binding'}
      </Button>
    </div>
  )
}

export function AddShortcutBinding(props: AddShortcutBindingProps) {
  const [target, setTarget] = useState(`builtin:${SHORTCUT_DEFINITIONS[0]?.command ?? ''}`)
  const [binding, setBinding] = useState<ShortcutBinding | null>(null)
  const [when, setWhen] = useState('')
  const [recording, setRecording] = useState(false)
  const builtInCommand = target.startsWith('builtin:') ? target.slice('builtin:'.length) : null
  const actionId = target.startsWith('project:') ? target.slice('project:'.length) : null
  const action = props.actions.find((candidate) => candidate.id === actionId) ?? null
  const normalizedWhen = when.trim()
  const valid =
    normalizedWhen.length === 0 || parseProjectActionWhenExpression(normalizedWhen) !== null
  const conflicts = shortcutBrowserConflictLabels(props.rows, {
    rowId: 'new-project-binding',
    binding,
    when: normalizedWhen,
  })

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!recording) return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') return setRecording(false)
    if (event.key === 'Backspace' || event.key === 'Delete') {
      setBinding(null)
      setRecording(false)
      return
    }
    const next = shortcutBindingFromEvent(event)
    if (next === null) {
      if (!isShortcutModifierKey(event.key)) {
        props.onError('Use Command, Control, Alt, or Shift with the key.')
      }
      return
    }
    setBinding(next)
    setRecording(false)
    props.onError(null)
  }

  async function save() {
    if (binding === null || !valid) return
    const rule = { shortcut: binding, ...(normalizedWhen ? { when: normalizedWhen } : {}) }
    if (builtInCommand !== null) {
      const command = SHORTCUT_DEFINITIONS.find(
        (definition) => definition.command === builtInCommand,
      )?.command
      if (command === undefined) return
      if (await props.onAddBuiltIn({ command, ...rule })) props.onClose()
      return
    }
    if (action === null) return
    if (await props.onUpdate(action.id, [...projectActionShortcutRules(action), rule])) {
      props.onClose()
    }
  }

  return (
    <section
      aria-labelledby="add-shortcut-binding-heading"
      className="space-y-4 rounded-lg border border-accent/25 bg-accent/5 p-4"
    >
      <AddShortcutHeader onClose={props.onClose} />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <ShortcutTargetSelect actions={props.actions} target={target} onChange={setTarget} />
        <ShortcutBindingButton
          label="Record new keyboard binding"
          binding={binding}
          recording={recording}
          disabled={props.saving}
          onClick={() => {
            setRecording(true)
            props.onError(null)
          }}
          onKeyDown={handleKeyDown}
        />
      </div>
      <ProjectActionConditionBuilder
        value={when}
        expressionLabel="When expression for new keyboard binding"
        onChange={setWhen}
      />
      <ShortcutConflictNotice labels={conflicts} />
      <AddShortcutFooter
        canSave={!props.saving && binding !== null && valid}
        saving={props.saving}
        onClose={props.onClose}
        onSave={() => void save()}
      />
    </section>
  )
}
