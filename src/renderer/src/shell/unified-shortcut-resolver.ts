import type { ProjectAction } from '@shared/types/project-actions'
import type { ExtensionRightPanelSurfaceId } from '@shared/types/right-panel-surface-id'
import {
  DEFAULT_SHORTCUT_RULES,
  type ShortcutBinding,
  type ShortcutRule,
  type ShortcutRules,
  shortcutRuleIdentity,
} from '@shared/types/shortcuts'
import { EXTENSION_PANEL_SHORTCUT_WHEN } from '@shared/utils/extension-panel-shortcuts'
import {
  orderedProjectActionShortcuts,
  type ProjectActionShortcutContext,
  projectActionShortcutMatches,
  projectActionWhenMatches,
} from '@shared/utils/project-action-shortcuts'

export type UnifiedShortcutMatch =
  | { readonly kind: 'builtin'; readonly rule: ShortcutRule }
  | { readonly kind: 'project'; readonly action: ProjectAction }
  | { readonly kind: 'extension-panel'; readonly surfaceId: ExtensionRightPanelSurfaceId }

/** A user binding for an extension side panel that is available right now. */
export interface ExtensionPanelShortcut {
  readonly surfaceId: ExtensionRightPanelSurfaceId
  readonly shortcut: ShortcutBinding
}

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

const DEFAULT_RULE_IDENTITIES = new Set(DEFAULT_SHORTCUT_RULES.map(shortcutRuleIdentity))

function matchExtensionPanel(
  event: ShortcutEvent,
  extensionPanels: readonly ExtensionPanelShortcut[],
  applePlatform: boolean,
  contextForMatch: () => ProjectActionShortcutContext,
): UnifiedShortcutMatch | null {
  for (const panel of extensionPanels) {
    if (!projectActionShortcutMatches(event, panel.shortcut, applePlatform)) continue
    if (projectActionWhenMatches(EXTENSION_PANEL_SHORTCUT_WHEN, contextForMatch())) {
      return { kind: 'extension-panel', surfaceId: panel.surfaceId }
    }
  }
  return null
}

/**
 * Project rules form the final project-scoped overlay after global built-in rules. Extension panel
 * shortcuts are conflict-free with built-in rules when saved, so they are only consulted when no
 * other rule claims the key, except against a default rule: a default added in a later release
 * (such as `session.copyLink`) must not take a chord the user already gave a panel.
 */
export function resolveUnifiedShortcut(
  event: ShortcutEvent,
  builtInRules: ShortcutRules,
  actions: readonly ProjectAction[],
  applePlatform: boolean,
  getContext: () => ProjectActionShortcutContext,
  extensionPanels: readonly ExtensionPanelShortcut[] = [],
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
    if (!projectActionWhenMatches(rule.when, contextForMatch())) continue
    const panel = DEFAULT_RULE_IDENTITIES.has(shortcutRuleIdentity(rule))
      ? matchExtensionPanel(event, extensionPanels, applePlatform, contextForMatch)
      : null
    return panel ?? { kind: 'builtin', rule }
  }
  return matchExtensionPanel(event, extensionPanels, applePlatform, contextForMatch)
}

export function hasModifierFreeUnifiedShortcut(
  builtInRules: ShortcutRules,
  actions: readonly ProjectAction[],
  extensionPanels: readonly ExtensionPanelShortcut[] = [],
) {
  const isModifierFree = (rule: { readonly shortcut: ShortcutRule['shortcut'] }) =>
    rule.shortcut.mod !== true &&
    rule.shortcut.ctrl !== true &&
    rule.shortcut.alt !== true &&
    rule.shortcut.shift !== true &&
    rule.shortcut.meta !== true
  return (
    builtInRules.some(isModifierFree) ||
    orderedProjectActionShortcuts(actions).some((entry) => isModifierFree(entry.rule)) ||
    extensionPanels.some(isModifierFree)
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
