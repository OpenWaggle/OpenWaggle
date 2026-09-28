import type { ProjectAction, ProjectActionShortcutRule } from '@shared/types/project-actions'
import {
  DEFAULT_SHORTCUT_RULES,
  RESERVED_SHORTCUT_KEYS,
  SHORTCUT_DEFINITIONS,
  type ShortcutBinding,
  type ShortcutCommand,
  type ShortcutRule,
  type ShortcutRules,
  shortcutBindingKey,
  shortcutRuleIdentity,
} from '@shared/types/shortcuts'
import {
  orderedProjectActionShortcuts,
  projectActionShortcutRules,
} from '@shared/utils/project-action-shortcuts'

export type ShortcutBrowserSource = 'Default' | 'Custom' | 'Project'

interface ShortcutBrowserRowBase {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly command: string
  readonly binding: ShortcutBinding
  readonly when: string
  readonly source: ShortcutBrowserSource
  readonly conflicts: readonly string[]
}

export interface BuiltInShortcutBrowserRow extends ShortcutBrowserRowBase {
  readonly kind: 'builtin'
  readonly command: ShortcutCommand
  readonly rule: ShortcutRule
  readonly ruleIndex: number
  readonly defaultRule: ShortcutRule | null
}

export interface ProjectShortcutBrowserRow extends ShortcutBrowserRowBase {
  readonly kind: 'project'
  readonly action: ProjectAction
  readonly rule: ProjectActionShortcutRule
  readonly ruleIndex: number
  readonly precedence: number
}

export type ShortcutBrowserRow = BuiltInShortcutBrowserRow | ProjectShortcutBrowserRow

function exactDefaultRule(rule: ShortcutRule) {
  const identity = shortcutRuleIdentity(rule)
  return DEFAULT_SHORTCUT_RULES.find((candidate) => shortcutRuleIdentity(candidate) === identity)
}

function nearestDefaultRule(rule: ShortcutRule) {
  return (
    exactDefaultRule(rule) ??
    DEFAULT_SHORTCUT_RULES.find(
      (candidate) =>
        candidate.command === rule.command &&
        (candidate.when?.trim() ?? '') === (rule.when?.trim() ?? ''),
    ) ??
    DEFAULT_SHORTCUT_RULES.find((candidate) => candidate.command === rule.command) ??
    null
  )
}

function commandMetadata(command: ShortcutCommand) {
  const definition = SHORTCUT_DEFINITIONS.find((candidate) => candidate.command === command)
  return {
    label: definition?.label ?? command,
    description: definition?.description ?? command,
  }
}

function conditionsMayOverlap(left: string, right: string) {
  return left.length === 0 || right.length === 0 || left === right
}

export function shortcutBrowserConflictLabels(
  rows: readonly ShortcutBrowserRow[],
  input: {
    readonly rowId: string
    readonly binding: ShortcutBinding | null
    readonly when: string
  },
) {
  if (input.binding === null) return []
  const key = shortcutBindingKey(input.binding)
  const labels: string[] = []
  const reserved = RESERVED_SHORTCUT_KEYS[key]
  if (reserved !== undefined) labels.push(reserved)
  for (const candidate of rows) {
    if (
      candidate.id !== input.rowId &&
      shortcutBindingKey(candidate.binding) === key &&
      conditionsMayOverlap(input.when, candidate.when)
    ) {
      labels.push(candidate.label)
    }
  }
  return [...new Set(labels)].sort((left, right) => left.localeCompare(right))
}

function matchesQuery(row: ShortcutBrowserRow, query: string) {
  if (query.length === 0) return true
  return [
    row.label,
    row.description,
    row.command,
    shortcutBindingKey(row.binding),
    row.when || 'always',
    row.source,
  ].some((value) => value.toLowerCase().includes(query))
}

export function buildShortcutBrowserRows(
  shortcutRules: ShortcutRules,
  actions: readonly ProjectAction[],
  query = '',
): readonly ShortcutBrowserRow[] {
  const builtInRows: BuiltInShortcutBrowserRow[] = shortcutRules.map((rule, ruleIndex) => {
    const metadata = commandMetadata(rule.command)
    return {
      id: `builtin:${String(ruleIndex)}:${shortcutRuleIdentity(rule)}`,
      kind: 'builtin',
      ...metadata,
      command: rule.command,
      binding: rule.shortcut,
      when: rule.when?.trim() ?? '',
      source: exactDefaultRule(rule) === undefined ? 'Custom' : 'Default',
      conflicts: [],
      rule,
      ruleIndex,
      defaultRule: nearestDefaultRule(rule),
    }
  })
  const projectRows: ProjectShortcutBrowserRow[] = orderedProjectActionShortcuts(actions).map(
    (entry) => ({
      id: `project:${entry.action.id}:${String(entry.ruleIndex)}`,
      kind: 'project',
      label: entry.action.name,
      description: entry.action.command,
      command: `projectAction.${entry.action.id}.run`,
      binding: entry.rule.shortcut,
      when: entry.rule.when?.trim() ?? '',
      source: 'Project',
      conflicts: [],
      action: entry.action,
      rule: entry.rule,
      ruleIndex: entry.ruleIndex,
      precedence: shortcutRules.length + entry.order,
    }),
  )
  const rows: ShortcutBrowserRow[] = [...builtInRows, ...projectRows]
  const withConflicts = rows.map((row) => ({
    ...row,
    conflicts: shortcutBrowserConflictLabels(rows, {
      rowId: row.id,
      binding: row.binding,
      when: row.when,
    }),
  }))
  const normalizedQuery = query.trim().toLowerCase()
  return withConflicts
    .filter((row) => matchesQuery(row, normalizedQuery))
    .sort(
      (left, right) =>
        left.label.localeCompare(right.label) ||
        left.command.localeCompare(right.command) ||
        left.when.localeCompare(right.when),
    )
}

export function projectActionBindingCount(actions: readonly ProjectAction[]) {
  return actions.reduce((count, action) => count + projectActionShortcutRules(action).length, 0)
}
