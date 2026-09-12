import type { ProjectAction } from '@shared/types/project-actions'
import type { ShortcutRule, ShortcutRules } from '@shared/types/shortcuts'
import {
  orderedProjectActionShortcuts,
  type ProjectActionShortcutContext,
  projectActionShortcutMatches,
  projectActionWhenMatches,
} from '@shared/utils/project-action-shortcuts'

export type UnifiedShortcutMatch =
  | { readonly kind: 'builtin'; readonly rule: ShortcutRule }
  | { readonly kind: 'project'; readonly action: ProjectAction }

interface ShortcutEvent {
  readonly key: string
  readonly code?: string
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly isComposing?: boolean
}

export function workspaceShortcutContext(event: KeyboardEvent): ProjectActionShortcutContext {
  const target = event.target instanceof Element ? event.target : null
  return {
    terminalFocus: target !== null && target.closest('[data-terminal-pane]') !== null,
    terminalOpen: document.querySelector('[data-terminal-pane]') !== null,
    previewFocus: target !== null && target.closest('[data-browser-preview-panel]') !== null,
    previewOpen: document.querySelector('[data-browser-preview-panel]') !== null,
    modelPickerOpen: document.querySelector('[data-model-picker-open]') !== null,
  }
}

/** Project rules form the final project-scoped overlay after global built-in rules. */
export function resolveUnifiedShortcut(
  event: ShortcutEvent,
  builtInRules: ShortcutRules,
  actions: readonly ProjectAction[],
  applePlatform: boolean,
  getContext: () => ProjectActionShortcutContext,
): UnifiedShortcutMatch | null {
  let context: ProjectActionShortcutContext | null = null
  const contextForMatch = () => {
    context ??= getContext()
    return context
  }
  const projectRules = orderedProjectActionShortcuts(actions)
  for (let index = projectRules.length - 1; index >= 0; index -= 1) {
    const entry = projectRules[index]
    if (entry === undefined) continue
    if (!projectActionShortcutMatches(event, entry.rule.shortcut, applePlatform)) continue
    if (projectActionWhenMatches(entry.rule.when, contextForMatch())) {
      return { kind: 'project', action: entry.action }
    }
  }
  for (let index = builtInRules.length - 1; index >= 0; index -= 1) {
    const rule = builtInRules[index]
    if (rule === undefined) continue
    if (!projectActionShortcutMatches(event, rule.shortcut, applePlatform)) continue
    if (projectActionWhenMatches(rule.when, contextForMatch())) return { kind: 'builtin', rule }
  }
  return null
}

export function hasModifierFreeUnifiedShortcut(
  builtInRules: ShortcutRules,
  actions: readonly ProjectAction[],
) {
  const isModifierFree = (rule: { readonly shortcut: ShortcutRule['shortcut'] }) =>
    rule.shortcut.mod !== true &&
    rule.shortcut.ctrl !== true &&
    rule.shortcut.alt !== true &&
    rule.shortcut.shift !== true &&
    rule.shortcut.meta !== true
  return (
    builtInRules.some(isModifierFree) ||
    orderedProjectActionShortcuts(actions).some((entry) => isModifierFree(entry.rule))
  )
}

export function isShortcutEditorTarget(event: KeyboardEvent) {
  if (!(event.target instanceof Element)) return false
  return (
    event.target.closest('[data-shortcut-capture], [data-project-action-shortcut-input]') !== null
  )
}

export function isTextEditingShortcutTarget(event: KeyboardEvent) {
  if (!(event.target instanceof Element)) return false
  const editable = event.target.closest('input, textarea, select, [contenteditable="true"]')
  return editable !== null && event.target.closest('[data-terminal-pane]') === null
}
