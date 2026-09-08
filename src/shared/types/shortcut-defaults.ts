import type { ShortcutBindings, ShortcutRules } from './shortcut-contract'

export const DEFAULT_SHORTCUT_BINDINGS = {
  'commandPalette.toggle': { key: 'K', mod: true },
  'filePicker.toggle': { key: 'P', mod: true },
  'chat.new': { key: 'N', mod: true },
  'terminal.toggle': { key: 'J', mod: true },
  'terminal.new': { key: 'N', mod: true },
  'terminal.split': { key: 'D', mod: true },
  'terminal.splitVertical': { key: 'D', mod: true, shift: true },
  'terminal.close': { key: 'W', mod: true },
  'rightPanel.toggle': { key: 'B', mod: true, alt: true },
  'rightPanel.toggleMaximized': null,
  'rightPanel.close': { key: 'W', mod: true },
  'sidebar.toggle': { key: 'B', mod: true },
  'diff.toggle': { key: 'D', mod: true },
  'preview.toggle': { key: 'J', mod: true, shift: true },
  'preview.refresh': { key: 'R', mod: true },
  'preview.focusUrl': { key: 'L', mod: true },
  'preview.zoomIn': { key: '=', mod: true },
  'preview.zoomOut': { key: '-', mod: true },
  'preview.resetZoom': { key: '0', mod: true },
  'sessionTree.toggle': { key: 'Y', mod: true, shift: true },
  // Moves focus to a pending request without moving the caret, so a keyboard user can reach the
  // decision and return to their sentence with Escape. Deliberately focuses the request rather than
  // answering it: no key is ever bound to a grant, because a mistyped chord must not be able to
  // grant a capability.
  'request.focus': { key: 'A', mod: true, shift: true },
} satisfies ShortcutBindings

/** T3's relevant defaults in the same precedence order, followed by OpenWaggle-only commands. */
export const DEFAULT_SHORTCUT_RULES: ShortcutRules = [
  { command: 'sidebar.toggle', shortcut: { key: 'B', mod: true } },
  { command: 'terminal.toggle', shortcut: { key: 'J', mod: true } },
  { command: 'rightPanel.toggle', shortcut: { key: 'B', mod: true, alt: true } },
  { command: 'terminal.split', shortcut: { key: 'D', mod: true }, when: 'terminalFocus' },
  {
    command: 'terminal.splitVertical',
    shortcut: { key: 'D', mod: true, shift: true },
    when: 'terminalFocus',
  },
  { command: 'terminal.new', shortcut: { key: 'N', mod: true }, when: 'terminalFocus' },
  { command: 'terminal.close', shortcut: { key: 'W', mod: true }, when: 'terminalFocus' },
  { command: 'rightPanel.close', shortcut: { key: 'W', mod: true }, when: '!terminalFocus' },
  { command: 'diff.toggle', shortcut: { key: 'D', mod: true }, when: '!terminalFocus' },
  { command: 'preview.toggle', shortcut: { key: 'J', mod: true, shift: true } },
  { command: 'preview.refresh', shortcut: { key: 'R', mod: true }, when: 'previewFocus' },
  { command: 'preview.focusUrl', shortcut: { key: 'L', mod: true }, when: 'previewFocus' },
  { command: 'preview.zoomIn', shortcut: { key: '=', mod: true }, when: 'previewFocus' },
  { command: 'preview.zoomIn', shortcut: { key: '+', mod: true }, when: 'previewFocus' },
  { command: 'preview.zoomOut', shortcut: { key: '-', mod: true }, when: 'previewFocus' },
  { command: 'preview.resetZoom', shortcut: { key: '0', mod: true }, when: 'previewFocus' },
  {
    command: 'commandPalette.toggle',
    shortcut: { key: 'K', mod: true },
    when: '!terminalFocus',
  },
  { command: 'filePicker.toggle', shortcut: { key: 'P', mod: true }, when: '!terminalFocus' },
  { command: 'chat.new', shortcut: { key: 'N', mod: true }, when: '!terminalFocus' },
  {
    command: 'chat.new',
    shortcut: { key: 'O', mod: true, shift: true },
    when: '!terminalFocus',
  },
  {
    command: 'sessionTree.toggle',
    shortcut: { key: 'Y', mod: true, shift: true },
    when: '!terminalFocus',
  },
  { command: 'request.focus', shortcut: { key: 'A', mod: true, shift: true } },
]
