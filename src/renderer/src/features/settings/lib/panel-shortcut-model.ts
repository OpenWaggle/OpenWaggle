import type { ExtensionRightPanelSurfaceId } from '@shared/types/right-panel-surface-id'
import {
  isExtensionRightPanelSurfaceId,
  parseExtensionRightPanelSurfaceId,
} from '@shared/types/right-panel-surface-id'
import {
  DEFAULT_SHORTCUT_RULES,
  type ExtensionPanelShortcutBindings,
  type ShortcutBinding,
  type ShortcutCommand,
  type ShortcutRule,
  type ShortcutRules,
  shortcutBindingsFromRules,
  shortcutDefinition,
  shortcutRuleIdentity,
  shortcutWhenForScope,
} from '@shared/types/shortcuts'
import {
  EXTENSION_PANEL_SHORTCUT_WHEN,
  extensionPanelShortcutConflicts,
} from '@shared/utils/extension-panel-shortcuts'
import type { ExtensionSidePanelSurfaceEntry } from '@/features/extensions'
import { BUILT_IN_RIGHT_PANEL_SURFACES } from '@/shared/lib/right-panel-catalog'
import type { ShortcutConflictSource } from './shortcut-browser-model'

export interface PanelCommandShortcutRow {
  readonly kind: 'command'
  readonly id: string
  readonly label: string
  readonly description: string
  readonly command: ShortcutCommand
  readonly binding: ShortcutBinding | null
  /** The command's rules differ from its defaults. */
  readonly custom: boolean
  /** Unassigned is a valid state only for commands without a default binding. */
  readonly clearable: boolean
}

export interface ExtensionPanelShortcutRow {
  readonly kind: 'extension-panel'
  readonly id: string
  readonly label: string
  readonly description: string
  readonly surfaceId: ExtensionRightPanelSurfaceId
  readonly binding: ShortcutBinding | null
  readonly installed: boolean
}

export type PanelShortcutRow = PanelCommandShortcutRow | ExtensionPanelShortcutRow

export interface PanelShortcutGroup {
  readonly id: string
  readonly title: string
  readonly rows: readonly PanelShortcutRow[]
}

const TOGGLE_RIGHT_PANEL_COMMAND = 'rightPanel.toggle' satisfies ShortcutCommand

function commandRuleIdentities(rules: ShortcutRules, command: ShortcutCommand) {
  return rules
    .filter((rule) => rule.command === command)
    .map(shortcutRuleIdentity)
    .sort()
    .join('\n')
}

function hasDefaultBinding(command: ShortcutCommand) {
  return DEFAULT_SHORTCUT_RULES.some((rule) => rule.command === command)
}

function commandRow(
  rules: ShortcutRules,
  command: ShortcutCommand,
  label: string,
  description: string,
): PanelCommandShortcutRow {
  const binding = shortcutBindingsFromRules(rules)[command]
  return {
    kind: 'command',
    id: `command:${command}`,
    label,
    description,
    command,
    binding,
    custom:
      commandRuleIdentities(rules, command) !==
      commandRuleIdentities(DEFAULT_SHORTCUT_RULES, command),
    clearable: binding !== null && !hasDefaultBinding(command),
  }
}

/** Built-in panel commands in Panel rail order, then the Right panel toggle. */
export function buildBuiltInPanelShortcutRows(
  rules: ShortcutRules,
): readonly PanelCommandShortcutRow[] {
  const toggle = shortcutDefinition(TOGGLE_RIGHT_PANEL_COMMAND)
  return [
    ...BUILT_IN_RIGHT_PANEL_SURFACES.map((surface) =>
      commandRow(rules, surface.command, surface.title, surface.description),
    ),
    commandRow(
      rules,
      TOGGLE_RIGHT_PANEL_COMMAND,
      toggle?.label ?? 'Toggle right panel',
      'Show or hide the Right panel with the surface it last showed',
    ),
  ]
}

function extensionPanelLabel(surfaceId: string, panels: readonly ExtensionSidePanelSurfaceEntry[]) {
  const panel = panels.find((candidate) => candidate.surfaceId === surfaceId)
  if (panel !== undefined) return `${panel.entry.title} (${panel.entry.extensionName})`
  const identity = parseExtensionRightPanelSurfaceId(surfaceId)
  return identity === null ? surfaceId : `${identity.sidePanelId} (${identity.extensionId})`
}

/**
 * Extension side panels grouped under their extension's name, followed by remembered bindings of
 * panels whose extension is not installed now. Those are kept so a reinstall gets them back.
 */
export function buildExtensionPanelShortcutGroups(
  panels: readonly ExtensionSidePanelSurfaceEntry[],
  bindings: ExtensionPanelShortcutBindings,
): readonly PanelShortcutGroup[] {
  const groups = new Map<string, { title: string; rows: ExtensionPanelShortcutRow[] }>()
  for (const panel of panels) {
    const key = panel.entry.extensionId
    const group = groups.get(key) ?? { title: panel.entry.extensionName, rows: [] }
    group.rows.push({
      kind: 'extension-panel',
      id: panel.surfaceId,
      label: panel.entry.title,
      description: panel.openable
        ? `Show or hide ${panel.entry.title} in the Right panel`
        : `Show or hide ${panel.entry.title} in the Right panel once it can run`,
      surfaceId: panel.surfaceId,
      binding: bindings[panel.surfaceId] ?? null,
      installed: true,
    })
    groups.set(key, group)
  }
  const installed = new Set<string>(panels.map((panel) => panel.surfaceId))
  const remembered: ExtensionPanelShortcutRow[] = Object.entries(bindings).flatMap(
    ([surfaceId, binding]) => {
      if (installed.has(surfaceId) || !isExtensionRightPanelSurfaceId(surfaceId)) return []
      const identity = parseExtensionRightPanelSurfaceId(surfaceId)
      if (identity === null) return []
      return [
        {
          kind: 'extension-panel',
          id: surfaceId,
          label: identity.sidePanelId,
          description: `${identity.extensionId} · extension not installed`,
          surfaceId,
          binding,
          installed: false,
        },
      ]
    },
  )
  return [
    ...[...groups.entries()]
      .sort(([, left], [, right]) => left.title.localeCompare(right.title))
      .map(([key, group]) => ({ id: `extension:${key}`, title: group.title, rows: group.rows })),
    ...(remembered.length > 0
      ? [{ id: 'not-installed', title: 'Extensions not installed', rows: remembered }]
      : []),
  ]
}

/** Extension panel bindings as sources for the rule browser's conflict labels. */
export function extensionPanelConflictSources(
  panels: readonly ExtensionSidePanelSurfaceEntry[],
  bindings: ExtensionPanelShortcutBindings,
): readonly ShortcutConflictSource[] {
  return Object.entries(bindings).map(([surfaceId, binding]) => ({
    id: `extension-panel:${surfaceId}`,
    label: extensionPanelLabel(surfaceId, panels),
    binding,
    when: EXTENSION_PANEL_SHORTCUT_WHEN,
  }))
}

/** Rules after recording a new binding for one command, keeping the command's other rules. */
export function panelCommandRulesWithBinding(
  rules: ShortcutRules,
  command: ShortcutCommand,
  binding: ShortcutBinding,
): ShortcutRules {
  const representative = rules.filter((rule) => rule.command === command).at(-1)
  const defaultRule = DEFAULT_SHORTCUT_RULES.find((rule) => rule.command === command)
  const scope = shortcutDefinition(command)?.scope ?? 'global'
  const when = (representative ?? defaultRule)?.when ?? shortcutWhenForScope(scope)
  const next: ShortcutRule = { command, shortcut: binding, ...(when.length > 0 ? { when } : {}) }
  if (representative === undefined) return [...rules, next]
  const replaced = shortcutRuleIdentity(representative)
  return [...rules.filter((rule) => shortcutRuleIdentity(rule) !== replaced), next]
}

/** Rules without any rule for the command; the store restores defaults for commands that have them. */
export function panelCommandRulesWithoutCommand(rules: ShortcutRules, command: ShortcutCommand) {
  return rules.filter((rule) => rule.command !== command)
}

/**
 * Labels of what an extension panel binding would collide with. Extension panel shortcuts are
 * conflict-free, so any label blocks saving.
 */
export function extensionPanelBindingConflictLabels(input: {
  readonly rules: ShortcutRules
  readonly bindings: ExtensionPanelShortcutBindings
  readonly panels: readonly ExtensionSidePanelSurfaceEntry[]
  readonly target:
    | { readonly kind: 'extension-panel'; readonly surfaceId: string }
    | {
        readonly kind: 'command'
        readonly command: ShortcutCommand
      }
}) {
  const labels = extensionPanelShortcutConflicts(input).flatMap((conflict) => {
    if (input.target.kind === 'command') {
      return conflict.owner.kind === 'command' && conflict.owner.command === input.target.command
        ? [extensionPanelLabel(conflict.surfaceId, input.panels)]
        : []
    }
    const targetId = input.target.surfaceId
    if (conflict.surfaceId === targetId) {
      return [
        conflict.owner.kind === 'extension-panel'
          ? extensionPanelLabel(conflict.owner.surfaceId, input.panels)
          : conflict.owner.label,
      ]
    }
    return conflict.owner.kind === 'extension-panel' && conflict.owner.surfaceId === targetId
      ? [extensionPanelLabel(conflict.surfaceId, input.panels)]
      : []
  })
  return [...new Set(labels)].sort((left, right) => left.localeCompare(right))
}
