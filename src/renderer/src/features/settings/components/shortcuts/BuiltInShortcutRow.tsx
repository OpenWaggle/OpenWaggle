import {
  type ShortcutBinding,
  type ShortcutRule,
  shortcutBindingKey,
} from '@shared/types/shortcuts'
import { parseProjectActionWhenExpression } from '@shared/utils/project-action-shortcuts'
import { RotateCcw, Trash2, X } from 'lucide-react'
import { type KeyboardEvent, useState } from 'react'
import { ProjectActionConditionBuilder } from '@/features/project-actions'
import { Button } from '@/shared/ui/Button'
import {
  type BuiltInShortcutBrowserRow,
  type ShortcutBrowserRow,
  shortcutBrowserConflictLabels,
} from '../../lib/shortcut-browser-model'
import {
  isShortcutModifierKey,
  ShortcutBindingButton,
  ShortcutConflictNotice,
  ShortcutSourceBadge,
  shortcutBindingFromEvent,
} from './ShortcutRowParts'

interface BuiltInShortcutRowProps {
  readonly row: BuiltInShortcutBrowserRow
  readonly rows: readonly ShortcutBrowserRow[]
  readonly saving: boolean
  readonly onError: (message: string | null) => void
  readonly onRemove: (rule: ShortcutRule) => Promise<boolean>
  readonly onUpsert: (next: ShortcutRule, replace: ShortcutRule) => Promise<boolean>
}

function BuiltInShortcutMetadata({ row }: { readonly row: BuiltInShortcutBrowserRow }) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-medium text-text-primary">{row.label}</h3>
        <ShortcutSourceBadge source={row.source} />
      </div>
      <p className="text-xs text-text-tertiary">{row.description}</p>
      <div className="font-mono text-xs text-text-muted">{row.command}</div>
    </div>
  )
}

function BuiltInShortcutCondition({
  row,
  when,
  normalizedWhen,
  onChange,
}: {
  readonly row: BuiltInShortcutBrowserRow
  readonly when: string
  readonly normalizedWhen: string
  readonly onChange: (value: string) => void
}) {
  return (
    <details className="group rounded-md border border-border bg-bg">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs text-text-secondary">
        <span>
          When <code className="font-mono text-text-primary">{normalizedWhen || 'Always'}</code>
        </span>
        <span className="text-text-muted group-open:hidden">Edit condition</span>
      </summary>
      <div className="border-t border-border p-3">
        <ProjectActionConditionBuilder
          value={when}
          expressionLabel={`When expression for ${row.label}`}
          onChange={onChange}
        />
      </div>
    </details>
  )
}

function builtInShortcutDraftRule(
  row: BuiltInShortcutBrowserRow,
  binding: ShortcutBinding,
  when: string,
): ShortcutRule {
  return {
    command: row.command,
    shortcut: binding,
    ...(when.length > 0 ? { when } : {}),
  }
}

export function BuiltInShortcutRow({
  row,
  rows,
  saving,
  onError,
  onRemove,
  onUpsert,
}: BuiltInShortcutRowProps) {
  const [binding, setBinding] = useState<ShortcutBinding>(row.binding)
  const [when, setWhen] = useState(row.when)
  const [recording, setRecording] = useState(false)
  const persistedKey = shortcutBindingKey(row.binding)
  const normalizedWhen = when.trim()
  const valid =
    normalizedWhen.length === 0 || parseProjectActionWhenExpression(normalizedWhen) !== null
  const dirty = shortcutBindingKey(binding) !== persistedKey || normalizedWhen !== row.when
  const conflicts = shortcutBrowserConflictLabels(rows, {
    rowId: row.id,
    binding,
    when: normalizedWhen,
  })

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

  return (
    <article className="space-y-3 px-4 py-3.5">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <BuiltInShortcutMetadata row={row} />
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
                disabled={saving || !valid}
                onClick={() =>
                  void onUpsert(builtInShortcutDraftRule(row, binding, normalizedWhen), row.rule)
                }
              >
                Save
              </Button>
            </>
          ) : null}
          {row.source === 'Custom' && row.defaultRule !== null ? (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Reset binding"
              aria-label={`Reset ${row.label}`}
              disabled={saving}
              onClick={() => void onUpsert(row.defaultRule ?? row.rule, row.rule)}
            >
              <RotateCcw className="size-3" />
            </Button>
          ) : null}
          {row.source !== 'Default' ? (
            <Button
              variant="ghost"
              size="icon-sm"
              title="Remove binding"
              aria-label={`Remove binding for ${row.label}`}
              disabled={saving}
              onClick={() => void onRemove(row.rule)}
            >
              <Trash2 className="size-3" />
            </Button>
          ) : null}
          <ShortcutBindingButton
            label={`Change ${row.label}`}
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
      <BuiltInShortcutCondition
        row={row}
        when={when}
        normalizedWhen={normalizedWhen}
        onChange={setWhen}
      />
      <ShortcutConflictNotice labels={conflicts} />
    </article>
  )
}
