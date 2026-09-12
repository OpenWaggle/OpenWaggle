import { SHORTCUT_DEFINITIONS, shortcutWhenForScope } from './shortcut-catalog'
import {
  SHORTCUT_COMMANDS,
  SHORTCUT_RULE_LIMITS,
  type ShortcutBinding,
  type ShortcutBindings,
  type ShortcutCommand,
  type ShortcutRule,
  type ShortcutRules,
} from './shortcut-contract'
import { DEFAULT_SHORTCUT_BINDINGS, DEFAULT_SHORTCUT_RULES } from './shortcut-defaults'

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

function shortcutBindingMatches(left: ShortcutBinding | null, right: ShortcutBinding | null) {
  if (left === null || right === null) return left === right
  return shortcutBindingKey(left) === shortcutBindingKey(right)
}

function hasDefaultShortcutBindings(bindings: ShortcutBindings) {
  return SHORTCUT_COMMANDS.every((command) =>
    shortcutBindingMatches(bindings[command], DEFAULT_SHORTCUT_BINDINGS[command]),
  )
}

/** Builds the lossy one-binding compatibility view used by older renderer consumers. */
export function shortcutBindingsFromRules(rules: ShortcutRules): ShortcutBindings {
  const bindings: Record<ShortcutCommand, ShortcutBinding | null> = {
    'commandPalette.toggle': null,
    'filePicker.toggle': null,
    'chat.new': null,
    'terminal.toggle': null,
    'terminal.new': null,
    'terminal.split': null,
    'terminal.splitVertical': null,
    'terminal.close': null,
    'rightPanel.toggle': null,
    'rightPanel.toggleMaximized': null,
    'rightPanel.close': null,
    'sidebar.toggle': null,
    'diff.toggle': null,
    'preview.toggle': null,
    'preview.refresh': null,
    'preview.focusUrl': null,
    'preview.zoomIn': null,
    'preview.zoomOut': null,
    'preview.resetZoom': null,
    'sessionTree.toggle': null,
    'request.focus': null,
  }
  for (const rule of rules) bindings[rule.command] = rule.shortcut
  return bindings
}

/** Migrates the legacy record in deterministic definition order with its former fixed scopes. */
export function shortcutRulesFromBindings(bindings: ShortcutBindings): ShortcutRules {
  if (hasDefaultShortcutBindings(bindings)) return DEFAULT_SHORTCUT_RULES
  const migrated = SHORTCUT_DEFINITIONS.flatMap((definition) => {
    const shortcut = bindings[definition.command]
    if (shortcut === null) return []
    const when = shortcutWhenForScope(definition.scope)
    return [
      {
        command: definition.command,
        shortcut,
        ...(when.length > 0 ? { when } : {}),
      },
    ]
  })
  const zoomIn = bindings['preview.zoomIn']
  if (
    zoomIn !== null &&
    shortcutBindingKey(zoomIn) === shortcutBindingKey(DEFAULT_SHORTCUT_BINDINGS['preview.zoomIn'])
  ) {
    migrated.push({
      command: 'preview.zoomIn',
      shortcut: { key: '+', mod: true },
      when: 'previewFocus',
    })
  }
  return migrated
}

/** T3-compatible runtime merge: any persisted rule overrides all defaults for its command. */
export function shortcutRulesWithDefaults(customRules: ShortcutRules): ShortcutRules {
  if (customRules.length === 0) return DEFAULT_SHORTCUT_RULES
  const overriddenCommands = new Set(customRules.map((rule) => rule.command))
  return [
    ...DEFAULT_SHORTCUT_RULES.filter((rule) => !overriddenCommands.has(rule.command)),
    ...customRules,
  ].slice(-SHORTCUT_RULE_LIMITS.RULES)
}

export function shortcutRuleIdentity(rule: ShortcutRule) {
  return `${rule.command}\u0000${shortcutBindingKey(rule.shortcut)}\u0000${rule.when?.trim() ?? ''}`
}
