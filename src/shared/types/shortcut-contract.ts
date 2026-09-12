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
] as const

export type ShortcutCommand = (typeof SHORTCUT_COMMANDS)[number]

export interface ShortcutBinding {
  readonly key: string
  readonly mod?: boolean
  readonly ctrl?: boolean
  readonly shift?: boolean
  readonly alt?: boolean
  readonly meta?: boolean
}

export type ShortcutBindings = Readonly<Record<ShortcutCommand, ShortcutBinding | null>>

export const SHORTCUT_RULE_LIMITS = {
  KEY_LENGTH: 64,
  RULES: 256,
  WHEN_LENGTH: 256,
} as const

/** One ordered built-in command rule. Later active rules win globally. */
export interface ShortcutRule {
  readonly command: ShortcutCommand
  readonly shortcut: ShortcutBinding
  readonly when?: string
}

export type ShortcutRules = readonly ShortcutRule[]

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
