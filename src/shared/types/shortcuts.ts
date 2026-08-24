export const SHORTCUT_COMMANDS = [
  'commandPalette.toggle',
  'filePicker.toggle',
  'chat.new',
  'terminal.toggle',
  'sidebar.toggle',
  'diff.toggle',
  'sessionTree.toggle',
  'request.focus',
] as const

export type ShortcutCommand = (typeof SHORTCUT_COMMANDS)[number]

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

export interface ShortcutBinding {
  readonly key: string
  readonly mod?: boolean
  readonly ctrl?: boolean
  readonly shift?: boolean
  readonly alt?: boolean
  readonly meta?: boolean
}

export type ShortcutBindings = Readonly<Record<ShortcutCommand, ShortcutBinding | null>>

export interface ShortcutDefinition {
  readonly command: ShortcutCommand
  readonly label: string
  readonly description: string
  readonly group: 'Navigation' | 'Workspace'
}

export const SHORTCUT_DEFINITIONS: readonly ShortcutDefinition[] = [
  {
    command: 'commandPalette.toggle',
    label: 'Command palette',
    description: 'Search app actions, projects, and recent sessions',
    group: 'Navigation',
  },
  {
    command: 'filePicker.toggle',
    label: 'Go to file',
    description: 'Search files in the active project',
    group: 'Navigation',
  },
  {
    command: 'chat.new',
    label: 'New session',
    description: 'Start a draft session in the active project',
    group: 'Navigation',
  },
  {
    command: 'sidebar.toggle',
    label: 'Toggle sidebar',
    description: 'Show or hide project navigation',
    group: 'Workspace',
  },
  {
    command: 'terminal.toggle',
    label: 'Toggle terminal',
    description: 'Show or hide the project terminal',
    group: 'Workspace',
  },
  {
    command: 'diff.toggle',
    label: 'Toggle diff',
    description: 'Show or hide uncommitted changes',
    group: 'Workspace',
  },
  {
    command: 'sessionTree.toggle',
    label: 'Toggle session tree',
    description: 'Show or hide the session tree',
    group: 'Workspace',
  },
  {
    command: 'request.focus',
    label: 'Go to pending request',
    description: 'Move focus to a request waiting for you, without losing your place',
    group: 'Workspace',
  },
]

export const DEFAULT_SHORTCUT_BINDINGS: Readonly<Record<ShortcutCommand, ShortcutBinding>> = {
  'commandPalette.toggle': { key: 'K', mod: true },
  'filePicker.toggle': { key: 'P', mod: true },
  'chat.new': { key: 'N', mod: true },
  'terminal.toggle': { key: 'J', mod: true },
  'sidebar.toggle': { key: 'B', mod: true },
  'diff.toggle': { key: 'D', mod: true },
  'sessionTree.toggle': { key: 'Y', mod: true, shift: true },
  // Moves focus to a pending request without moving the caret, so a keyboard user can reach the
  // decision and return to their sentence with Escape. Deliberately focuses the request rather than
  // answering it: no key is ever bound to a grant, because a mistyped chord must not be able to
  // grant a capability.
  'request.focus': { key: 'A', mod: true, shift: true },
}

export function shortcutBindingKey(binding: ShortcutBinding) {
  return [
    binding.mod ? 'Mod' : '',
    binding.ctrl ? 'Control' : '',
    binding.alt ? 'Alt' : '',
    binding.shift ? 'Shift' : '',
    binding.meta ? 'Meta' : '',
    binding.key.trim().toUpperCase(),
  ]
    .filter(Boolean)
    .join('+')
}

export function isMandatoryShortcutCommand(command: ShortcutCommand) {
  return MANDATORY_SHORTCUT_COMMANDS.includes(command)
}
