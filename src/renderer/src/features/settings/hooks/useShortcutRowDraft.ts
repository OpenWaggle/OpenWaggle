import { type ShortcutBinding, shortcutBindingKey } from '@shared/types/shortcuts'
import { parseProjectActionWhenExpression } from '@shared/utils/project-action-shortcuts'
import { type KeyboardEvent, useState } from 'react'
import { isShortcutModifierKey, shortcutBindingFromEvent } from '@/shared/ui/ShortcutRecorder'
import {
  type ShortcutConflictSource,
  shortcutBrowserConflictLabels,
} from '../lib/shortcut-browser-model'

/**
 * The unsaved binding and `when` condition of one shortcut row, with key recording. Escape
 * while recording restores the saved binding; a key without a modifier reports an error.
 */
export function useShortcutRowDraft(
  row: ShortcutConflictSource,
  rows: readonly ShortcutConflictSource[],
  onError: (message: string | null) => void,
) {
  const [binding, setBinding] = useState<ShortcutBinding>(row.binding)
  const [when, setWhen] = useState(row.when)
  const [recording, setRecording] = useState(false)
  const normalizedWhen = when.trim()
  const whenIsValid =
    normalizedWhen.length === 0 || parseProjectActionWhenExpression(normalizedWhen) !== null
  const dirty =
    shortcutBindingKey(binding) !== shortcutBindingKey(row.binding) || normalizedWhen !== row.when
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

  function discard() {
    setBinding(row.binding)
    setWhen(row.when)
  }

  function startRecording() {
    setRecording(true)
    onError(null)
  }

  return {
    binding,
    when,
    setWhen,
    recording,
    normalizedWhen,
    whenIsValid,
    dirty,
    conflicts,
    handleKeyDown,
    discard,
    startRecording,
  }
}
