import type { ProjectAction } from '@shared/types/project-actions'
import type { ShortcutBinding, ShortcutBindings } from '@shared/types/shortcuts'
import {
  type OrderedProjectActionShortcut,
  orderedProjectActionShortcuts,
  type ProjectActionShortcutContext,
  projectActionShortcutMatches,
  projectActionWhenMatches,
} from '@shared/utils/project-action-shortcuts'
import { useEffect, useRef } from 'react'
import { usesAppleShortcuts } from '@/shared/lib/shortcut-display'
import { useUIStore } from '@/shell/ui-store'

interface ProjectActionShortcutCaptureOptions {
  readonly actions: readonly ProjectAction[]
  readonly builtInBindings: ShortcutBindings
  readonly onRun: (action: ProjectAction) => void
}

function isEditableShortcutTarget(event: KeyboardEvent) {
  if (!(event.target instanceof Element)) return false
  return event.target.closest('[data-project-action-shortcut-input]') !== null
}

function isModifierFree(shortcut: ShortcutBinding) {
  return (
    shortcut.mod !== true &&
    shortcut.ctrl !== true &&
    shortcut.alt !== true &&
    shortcut.shift !== true &&
    shortcut.meta !== true
  )
}

function repeatableMatchEvent(event: KeyboardEvent) {
  return {
    key: event.key,
    code: event.code,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    isComposing: event.isComposing,
    repeat: false,
  }
}

function shortcutContext(event: KeyboardEvent): ProjectActionShortcutContext {
  const target = event.target instanceof Element ? event.target : null
  return {
    terminalFocus: target !== null && target.closest('[data-terminal-pane]') !== null,
    terminalOpen: document.querySelector('[data-terminal-pane]') !== null,
    previewFocus: target !== null && target.closest('[data-browser-preview-panel]') !== null,
    previewOpen: document.querySelector('[data-browser-preview-panel]') !== null,
    modelPickerOpen: document.querySelector('[data-model-picker-open]') !== null,
  }
}

function resolveMatchingAction(
  event: KeyboardEvent,
  ordered: readonly OrderedProjectActionShortcut[],
  applePlatform: boolean,
) {
  const matchEvent = repeatableMatchEvent(event)
  let context: ProjectActionShortcutContext | null = null
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const entry = ordered[index]
    if (entry === undefined) continue
    if (!projectActionShortcutMatches(matchEvent, entry.rule.shortcut, applePlatform)) continue
    context ??= shortcutContext(event)
    if (projectActionWhenMatches(entry.rule.when, context)) return entry.action
  }
  return null
}

/** Claims project action chords before xterm and consumes the matching Kitty release. */
export function useProjectActionShortcutCapture(options: ProjectActionShortcutCaptureOptions) {
  const suppressedKeyUpsRef = useRef(new Set<string>())
  const onRunRef = useRef(options.onRun)
  onRunRef.current = options.onRun

  useEffect(() => {
    const ordered = orderedProjectActionShortcuts(options.actions)
    const hasModifierFreeBinding = ordered.some((entry) => isModifierFree(entry.rule.shortcut))
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableShortcutTarget(event)) return
      if (useUIStore.getState().commandSurface !== null) return
      if (
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        !hasModifierFreeBinding
      ) {
        return
      }
      const applePlatform = usesAppleShortcuts()
      const matchingAction = resolveMatchingAction(event, ordered, applePlatform)
      if (matchingAction === null) return
      if (event.code.length > 0) suppressedKeyUpsRef.current.add(event.code)
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      if (!event.repeat) onRunRef.current(matchingAction)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (!suppressedKeyUpsRef.current.delete(event.code)) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }
    const clearHeldKeys = () => suppressedKeyUpsRef.current.clear()
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', clearHeldKeys)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', clearHeldKeys)
      clearHeldKeys()
    }
  }, [options.actions])
}
