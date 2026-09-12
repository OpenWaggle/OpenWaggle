import type { ShortcutCommand, ShortcutDefinition } from './shortcut-contract'

export const MANDATORY_SHORTCUT_COMMANDS: readonly ShortcutCommand[] = [
  'commandPalette.toggle',
  'filePicker.toggle',
  'chat.new',
]

/**
 * Combinations the app claims outside the configurable set, with what claims them.
 *
 * These are registered directly rather than through shortcutBindings, so the settings conflict
 * check could not see them: rebinding a command onto one produced two live handlers and a console
 * warning from the hotkey library, with nothing in the UI to explain it. Reserved rather than made
 * configurable, because their meaning is positional (the ninth pinned session is Mod+9) or tied to
 * a field that advertises the combination next to itself.
 */
export const RESERVED_SHORTCUT_KEYS: Readonly<Record<string, string>> = {
  'MOD+F': 'Filter sessions',
  'MOD+1': 'Pinned session 1',
  'MOD+2': 'Pinned session 2',
  'MOD+3': 'Pinned session 3',
  'MOD+4': 'Pinned session 4',
  'MOD+5': 'Pinned session 5',
  'MOD+6': 'Pinned session 6',
  'MOD+7': 'Pinned session 7',
  'MOD+8': 'Pinned session 8',
  'MOD+9': 'Pinned session 9',
}

export const SHORTCUT_DEFINITIONS: readonly ShortcutDefinition[] = [
  {
    command: 'commandPalette.toggle',
    label: 'Command palette',
    description: 'Search app actions, projects, and recent sessions',
    group: 'Navigation',
    scope: 'application',
  },
  {
    command: 'filePicker.toggle',
    label: 'Go to file',
    description: 'Search files in the active project',
    group: 'Navigation',
    scope: 'application',
  },
  {
    command: 'chat.new',
    label: 'New session',
    description: 'Start a draft session in the active project',
    group: 'Navigation',
    scope: 'application',
  },
  {
    command: 'sidebar.toggle',
    label: 'Toggle sidebar',
    description: 'Show or hide project navigation',
    group: 'Workspace',
    scope: 'global',
  },
  {
    command: 'terminal.toggle',
    label: 'Toggle terminal',
    description: 'Show or hide the session terminal',
    group: 'Workspace',
    scope: 'global',
  },
  {
    command: 'terminal.new',
    label: 'New terminal',
    description: 'Open another terminal for the active session',
    group: 'Workspace',
    scope: 'terminal',
  },
  {
    command: 'terminal.split',
    label: 'Split terminal side by side',
    description: 'Add a pane beside the active terminal',
    group: 'Workspace',
    scope: 'terminal',
  },
  {
    command: 'terminal.splitVertical',
    label: 'Split terminal vertically',
    description: 'Add a pane below the active terminal',
    group: 'Workspace',
    scope: 'terminal',
  },
  {
    command: 'terminal.close',
    label: 'Close terminal',
    description: 'Close the active terminal pane',
    group: 'Workspace',
    scope: 'terminal',
  },
  {
    command: 'rightPanel.toggle',
    label: 'Toggle right panel',
    description: 'Show or hide the retained workspace panel',
    group: 'Workspace',
    scope: 'global',
  },
  {
    command: 'rightPanel.toggleMaximized',
    label: 'Maximize right panel',
    description: 'Toggle the retained workspace panel between normal and maximized width',
    group: 'Workspace',
    scope: 'global',
  },
  {
    command: 'rightPanel.close',
    label: 'Close right panel',
    description: 'Hide the retained workspace panel outside terminal input',
    group: 'Workspace',
    scope: 'application',
  },
  {
    command: 'diff.toggle',
    label: 'Toggle diff',
    description: 'Show or hide uncommitted changes',
    group: 'Workspace',
    scope: 'application',
  },
  {
    command: 'sessionTree.toggle',
    label: 'Toggle session tree',
    description: 'Show or hide the session tree',
    group: 'Workspace',
    scope: 'application',
  },
  {
    command: 'preview.toggle',
    label: 'Toggle preview',
    description: 'Show or hide the most recent browser preview',
    group: 'Workspace',
    scope: 'global',
  },
  {
    command: 'preview.refresh',
    label: 'Refresh preview',
    description: 'Reload the active browser preview',
    group: 'Workspace',
    scope: 'preview',
  },
  {
    command: 'preview.focusUrl',
    label: 'Focus preview address',
    description: 'Select the active browser preview address',
    group: 'Navigation',
    scope: 'preview',
  },
  {
    command: 'preview.zoomIn',
    label: 'Zoom preview in',
    description: 'Increase the active browser preview zoom',
    group: 'Workspace',
    scope: 'preview',
  },
  {
    command: 'preview.zoomOut',
    label: 'Zoom preview out',
    description: 'Decrease the active browser preview zoom',
    group: 'Workspace',
    scope: 'preview',
  },
  {
    command: 'preview.resetZoom',
    label: 'Reset preview zoom',
    description: 'Restore the active browser preview zoom to 100%',
    group: 'Workspace',
    scope: 'preview',
  },
  {
    command: 'request.focus',
    label: 'Go to pending request',
    description: 'Move focus to a request waiting for you, without losing your place',
    group: 'Workspace',
    scope: 'global',
  },
]

export function shortcutWhenForScope(scope: ShortcutDefinition['scope']) {
  if (scope === 'terminal') return 'terminalFocus'
  if (scope === 'preview') return 'previewFocus'
  if (scope === 'application') return '!terminalFocus'
  return ''
}

export function isMandatoryShortcutCommand(command: ShortcutCommand) {
  return MANDATORY_SHORTCUT_COMMANDS.includes(command)
}

export function shortcutDefinition(command: ShortcutCommand) {
  return SHORTCUT_DEFINITIONS.find((definition) => definition.command === command)
}

export function shortcutScopesOverlap(left: ShortcutCommand, right: ShortcutCommand) {
  const leftScope = shortcutDefinition(left)?.scope ?? 'global'
  const rightScope = shortcutDefinition(right)?.scope ?? 'global'
  return leftScope === 'global' || rightScope === 'global' || leftScope === rightScope
}
