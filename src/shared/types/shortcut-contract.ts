import type { SchemaType } from '@shared/schema'
import type {
  extensionPanelShortcutBindingsSchema,
  shortcutBindingSchema,
  shortcutBindingsSchema,
  shortcutCommandSchema,
  shortcutRuleSchema,
  shortcutRulesSchema,
} from '@shared/schemas/settings-shortcuts'

export const SHORTCUT_COMMANDS = [
  'commandPalette.toggle',
  'filePicker.toggle',
  'chat.new',
  'terminal.toggle',
  'terminal.new',
  'terminal.split',
  'terminal.splitVertical',
  'terminal.close',
  'rightPanel.toggle',
  'rightPanel.toggleMaximized',
  'rightPanel.close',
  'sidebar.toggle',
  'diff.toggle',
  'preview.toggle',
  'preview.refresh',
  'preview.focusUrl',
  'preview.zoomIn',
  'preview.zoomOut',
  'preview.resetZoom',
  'sessionTree.toggle',
  'request.focus',
  'rightPanel.allPanels',
  'rightPanel.projectActions',
  'rightPanel.scheduledTasks',
  'rightPanel.files',
  'rightPanel.resources',
  'rightPanel.hive',
  'session.copyLink',
] as const

export type ShortcutCommand = SchemaType<typeof shortcutCommandSchema>

export type ShortcutBinding = SchemaType<typeof shortcutBindingSchema>

export type ShortcutBindings = SchemaType<typeof shortcutBindingsSchema>

/** User bindings for extension side panels, keyed by extension Right panel surface id (ADR 0043). */
export type ExtensionPanelShortcutBindings = SchemaType<typeof extensionPanelShortcutBindingsSchema>

export const EXTENSION_PANEL_SHORTCUT_LIMITS = {
  BINDINGS: 256,
} as const

export const SHORTCUT_RULE_LIMITS = {
  KEY_LENGTH: 64,
  RULES: 256,
  WHEN_LENGTH: 256,
} as const

/** One ordered built-in command rule. Later active rules win globally. */
export type ShortcutRule = SchemaType<typeof shortcutRuleSchema>

export type ShortcutRules = SchemaType<typeof shortcutRulesSchema>

export interface ShortcutDefinition {
  readonly command: ShortcutCommand
  readonly label: string
  readonly description: string
  readonly group: 'Navigation' | 'Workspace'
  /**
   * Context in which this shortcut owns its chord. Terminal and application
   * commands may deliberately share a chord (for example Mod+D), while global
   * commands conflict with both.
   */
  readonly scope: 'application' | 'global' | 'preview' | 'terminal'
}
