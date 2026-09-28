import type { ProjectActionShortcutRule } from '@shared/types/project-actions'
import type { ShortcutBinding } from '@shared/types/shortcuts'
import { useNavigate } from '@tanstack/react-router'
import { type KeyboardEvent, useState } from 'react'
import {
  buildShortcutBrowserRows,
  shortcutBrowserConflictLabels,
  usePreferencesStore,
} from '@/features/settings'
import { formatShortcutBinding } from '@/shared/lib/shortcut-display'
import { Button } from '@/shared/ui/Button'
import {
  isShortcutModifierKey,
  ShortcutBindingButton,
  shortcutBindingFromEvent,
} from '@/shared/ui/ShortcutRecorder'
import { useProjectActions } from '../../hooks/useProjectActions'

export function shortcutAnswer(rules: readonly ProjectActionShortcutRule[] | undefined) {
  if (!rules || rules.length === 0) return 'None'
  if (rules.length > 1 || rules[0]?.when)
    return `${String(rules.length)} shortcuts, managed in Settings`
  return formatShortcutBinding(rules[0]?.shortcut ?? null)
}

/**
 * One simple keyboard shortcut for the action (ADR 0038). Conditions and several bindings stay
 * in Settings → Shortcuts, which this links to.
 */
export function ShortcutSetting(props: {
  readonly projectPath: string
  readonly actionId: string
  readonly rules: readonly ProjectActionShortcutRule[] | undefined
  readonly onChange: (rules: readonly ProjectActionShortcutRule[]) => void
}) {
  const navigate = useNavigate()
  const builtIn = usePreferencesStore((state) => state.settings.shortcutRules)
  const actions =
    useProjectActions(props.projectPath, { projectPath: props.projectPath }).data ?? []
  const [recording, setRecording] = useState(false)
  const [pending, setPending] = useState<ShortcutBinding | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const rules = props.rules ?? []
  const advanced = rules.length > 1 || Boolean(rules[0]?.when)
  const openSettings = () => void navigate({ to: '/settings/$tab', params: { tab: 'shortcuts' } })
  if (advanced)
    return (
      <div className="grid gap-2 text-sm leading-6 text-text-tertiary">
        <p>This action has shortcuts with conditions, so they’re managed in Settings.</p>
        <Button variant="secondary" className="justify-self-start" onClick={openSettings}>
          Open shortcut settings
        </Button>
      </div>
    )
  const others = actions.filter((action) => action.id !== props.actionId)
  const rows = buildShortcutBrowserRows(builtIn, others)
  const conflicts = shortcutBrowserConflictLabels(rows, {
    rowId: `project:${props.actionId}:0`,
    binding: pending,
    when: '',
  })
  function commit(binding: ShortcutBinding) {
    props.onChange([
      { shortcut: binding, ...(rules[0]?.order !== undefined ? { order: rules[0].order } : {}) },
    ])
    setPending(null)
  }
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!recording) return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') return setRecording(false)
    const next = shortcutBindingFromEvent(event)
    if (next === null) {
      if (!isShortcutModifierKey(event.key))
        setHint('Hold Command, Control, Alt or Shift with the key.')
      return
    }
    setRecording(false)
    setHint(null)
    const clash = shortcutBrowserConflictLabels(rows, {
      rowId: `project:${props.actionId}:0`,
      binding: next,
      when: '',
    })
    if (clash.length > 0) setPending(next)
    else commit(next)
  }
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <ShortcutBindingButton
          label="Record a keyboard shortcut for this action"
          binding={rules[0]?.shortcut ?? null}
          recording={recording}
          onClick={() => {
            setRecording(true)
            setPending(null)
          }}
          onKeyDown={handleKeyDown}
        />
        {rules.length > 0 ? (
          <Button variant="ghost" onClick={() => props.onChange([])}>
            Remove shortcut
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-text-tertiary">
        {recording
          ? 'Press the keys you want. Escape stops recording.'
          : 'Click the box, then press the keys you want.'}
      </p>
      {hint ? <p className="text-sm text-text-tertiary">{hint}</p> : null}
      {pending ? (
        <div
          role="alert"
          className="grid gap-2 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3"
        >
          <p className="text-sm leading-6 text-text-secondary">
            {formatShortcutBinding(pending)} already does{' '}
            {conflicts.map((label) => `“${label}”`).join(', ')}. Use it for this action anyway?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => commit(pending)}>
              Use it anyway
            </Button>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Pick other keys
            </Button>
          </div>
        </div>
      ) : null}
      <Button
        variant="link"
        size="none"
        className="justify-self-start text-sm"
        onClick={openSettings}
      >
        More shortcut options
      </Button>
    </div>
  )
}
