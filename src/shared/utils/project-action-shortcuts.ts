import type { ProjectAction, ProjectActionShortcutRule } from '@shared/types/project-actions'
import type { ShortcutBinding } from '@shared/types/shortcuts'

export {
  evaluateProjectActionWhen,
  formatProjectActionWhenExpression,
  type ProjectActionShortcutContext,
  type ProjectActionWhenNode,
  parseProjectActionWhenExpression,
  projectActionWhenIdentifiers,
  projectActionWhenMatches,
} from './project-action-shortcut-when'

export interface OrderedProjectActionShortcut {
  readonly action: ProjectAction
  readonly actionIndex: number
  readonly rule: ProjectActionShortcutRule
  readonly ruleIndex: number
  readonly order: number
  readonly fallbackOrder: number
}

const EVENT_CODE_KEY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  BracketLeft: ['['],
  BracketRight: [']'],
  Digit0: ['0'],
  Digit1: ['1'],
  Digit2: ['2'],
  Digit3: ['3'],
  Digit4: ['4'],
  Digit5: ['5'],
  Digit6: ['6'],
  Digit7: ['7'],
  Digit8: ['8'],
  Digit9: ['9'],
  Equal: ['=', '+'],
  Minus: ['-'],
}

interface ProjectActionShortcutEvent {
  readonly key: string
  readonly code?: string
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly isComposing?: boolean
}

interface LegacyProjectActionShortcutCarrier {
  readonly shortcut?: ShortcutBinding
}

function normalizedEventKey(key: string) {
  const normalized = key.toLowerCase()
  return normalized === 'esc' ? 'escape' : normalized
}

function eventKeys(event: ProjectActionShortcutEvent) {
  const layoutKey = normalizedEventKey(event.key)
  const keys = new Set([layoutKey])
  const letterCode = event.code?.match(/^Key([A-Z])$/)?.[1]
  if (letterCode !== undefined && !/^[a-z]$/.test(layoutKey)) {
    keys.add(letterCode.toLowerCase())
  }
  const aliases = event.code === undefined ? undefined : EVENT_CODE_KEY_ALIASES[event.code]
  if (aliases !== undefined) {
    for (const alias of aliases) keys.add(alias)
  }
  return keys
}

/** Exact T3-compatible matching, including non-Latin physical-key and symbol aliases. */
export function projectActionShortcutMatches(
  event: ProjectActionShortcutEvent,
  binding: ShortcutBinding,
  applePlatform: boolean,
) {
  if (event.isComposing === true) return false
  const normalizedBindingKey = normalizedEventKey(binding.key.trim())
  const expectsCtrl = binding.ctrl === true || (binding.mod === true && !applePlatform)
  const expectsMeta = binding.meta === true || (binding.mod === true && applePlatform)
  const matchesImplicitPlusShift =
    normalizedBindingKey === '+' && normalizedEventKey(event.key) === '+' && event.shiftKey
  if (
    event.ctrlKey !== expectsCtrl ||
    event.metaKey !== expectsMeta ||
    event.altKey !== (binding.alt === true) ||
    (event.shiftKey !== (binding.shift === true) && !matchesImplicitPlusShift)
  ) {
    return false
  }
  return eventKeys(event).has(normalizedBindingKey)
}

/** The only runtime read of the deprecated one-binding shape. */
function legacyProjectActionShortcut(action: LegacyProjectActionShortcutCarrier) {
  return action.shortcut
}

/** Converts the legacy one-shortcut shape without rewriting the user's file on read. */
export function projectActionShortcutRules(
  action: ProjectAction,
): readonly ProjectActionShortcutRule[] {
  if (action.shortcutRules !== undefined) return action.shortcutRules
  const legacyShortcut = legacyProjectActionShortcut(action)
  return legacyShortcut === undefined ? [] : [{ shortcut: legacyShortcut }]
}

/**
 * Flattens nested action rules into T3's global rule order. Explicit orders let an edited rule move
 * to the end without changing the visible action order; legacy rules keep their file order.
 */
export function orderedProjectActionShortcuts(
  actions: readonly ProjectAction[],
): readonly OrderedProjectActionShortcut[] {
  const entries: OrderedProjectActionShortcut[] = []
  let fallbackOrder = 0
  actions.forEach((action, actionIndex) => {
    projectActionShortcutRules(action).forEach((rule, ruleIndex) => {
      entries.push({
        action,
        actionIndex,
        rule,
        ruleIndex,
        order: rule.order ?? fallbackOrder,
        fallbackOrder,
      })
      fallbackOrder += 1
    })
  })
  return entries.sort(
    (left, right) => left.order - right.order || left.fallbackOrder - right.fallbackOrder,
  )
}
