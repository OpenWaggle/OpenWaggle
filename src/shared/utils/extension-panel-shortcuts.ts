import { parseExtensionRightPanelSurfaceId } from '@shared/types/right-panel-surface-id'
import {
  type ExtensionPanelShortcutBindings,
  RESERVED_SHORTCUT_KEYS,
  type ShortcutBinding,
  type ShortcutCommand,
  type ShortcutRules,
  shortcutBindingKey,
  shortcutDefinition,
} from '@shared/types/shortcuts'

/**
 * Extension panel shortcuts toggle a Right panel surface like the built-in panel commands, so they
 * share those commands' application scope: active everywhere except inside a focused terminal.
 */
export const EXTENSION_PANEL_SHORTCUT_WHEN = '!terminalFocus'

const RESERVED_BY_NORMALIZED_KEY = new Map(
  Object.entries(RESERVED_SHORTCUT_KEYS).map(([key, label]) => [key.toUpperCase(), label]),
)

/** What directly registers a reserved combination, or null when the combination is free. */
export function reservedShortcutLabel(binding: ShortcutBinding) {
  return RESERVED_BY_NORMALIZED_KEY.get(shortcutBindingKey(binding).toUpperCase()) ?? null
}

/** The settings browser's overlap rule: an unconditional rule overlaps everything. */
export function shortcutConditionsMayOverlap(left: string | undefined, right: string | undefined) {
  const normalizedLeft = left?.trim() ?? ''
  const normalizedRight = right?.trim() ?? ''
  return (
    normalizedLeft.length === 0 ||
    normalizedRight.length === 0 ||
    normalizedLeft === normalizedRight
  )
}

export type ExtensionPanelShortcutOwner =
  | { readonly kind: 'reserved'; readonly label: string }
  | { readonly kind: 'command'; readonly command: ShortcutCommand; readonly label: string }
  | { readonly kind: 'extension-panel'; readonly surfaceId: string; readonly label: string }

export interface ExtensionPanelShortcutConflict {
  readonly surfaceId: string
  readonly key: string
  readonly owner: ExtensionPanelShortcutOwner
}

function extensionPanelFallbackLabel(surfaceId: string) {
  const identity = parseExtensionRightPanelSurfaceId(surfaceId)
  return identity === null
    ? 'another extension panel'
    : `extension panel ${identity.sidePanelId} (${identity.extensionId})`
}

function ownerIdentity(owner: ExtensionPanelShortcutOwner) {
  if (owner.kind === 'reserved') return `reserved:${owner.label}`
  if (owner.kind === 'command') return `command:${owner.command}`
  return `extension-panel:${owner.surfaceId}`
}

function conflictIdentity(conflict: ExtensionPanelShortcutConflict) {
  return `${conflict.surfaceId}\u0000${conflict.key}\u0000${ownerIdentity(conflict.owner)}`
}

/** Every binding that an extension panel shortcut shares with something else that can fire. */
export function extensionPanelShortcutConflicts(input: {
  readonly rules: ShortcutRules
  readonly bindings: ExtensionPanelShortcutBindings
}): readonly ExtensionPanelShortcutConflict[] {
  const entries = Object.entries(input.bindings).sort(([left], [right]) =>
    left.localeCompare(right),
  )
  const conflicts: ExtensionPanelShortcutConflict[] = []
  for (const [index, [surfaceId, binding]] of entries.entries()) {
    const key = shortcutBindingKey(binding)
    const reserved = reservedShortcutLabel(binding)
    if (reserved !== null) {
      conflicts.push({ surfaceId, key, owner: { kind: 'reserved', label: reserved } })
    }
    const claimedCommands = new Set<ShortcutCommand>()
    for (const rule of input.rules) {
      if (
        claimedCommands.has(rule.command) ||
        shortcutBindingKey(rule.shortcut) !== key ||
        !shortcutConditionsMayOverlap(rule.when, EXTENSION_PANEL_SHORTCUT_WHEN)
      ) {
        continue
      }
      claimedCommands.add(rule.command)
      conflicts.push({
        surfaceId,
        key,
        owner: {
          kind: 'command',
          command: rule.command,
          label: shortcutDefinition(rule.command)?.label ?? rule.command,
        },
      })
    }
    for (const [otherSurfaceId, otherBinding] of entries.slice(index + 1)) {
      if (shortcutBindingKey(otherBinding) !== key) continue
      conflicts.push({
        surfaceId,
        key,
        owner: {
          kind: 'extension-panel',
          surfaceId: otherSurfaceId,
          label: extensionPanelFallbackLabel(otherSurfaceId),
        },
      })
    }
  }
  return conflicts
}

interface ExtensionPanelShortcutState {
  readonly rules: ShortcutRules
  readonly bindings: ExtensionPanelShortcutBindings
}

function panelBindingKey(bindings: ExtensionPanelShortcutBindings, surfaceId: string) {
  const binding = Object.hasOwn(bindings, surfaceId) ? bindings[surfaceId] : undefined
  return binding === undefined ? null : shortcutBindingKey(binding)
}

/**
 * Rejects an update that introduces a conflict involving an extension panel shortcut. Conflicts
 * that already existed before the update do not block unrelated edits, so a stale saved state can
 * always be repaired one binding at a time. When the update changes the other side of a conflict
 * (for example, resets a built-in shortcut to a default an extension panel already uses), the
 * message names the extension panel that holds the combination.
 */
export function extensionPanelShortcutUpdateError(
  current: ExtensionPanelShortcutState,
  next: ExtensionPanelShortcutState,
) {
  const existing = new Set(extensionPanelShortcutConflicts(current).map(conflictIdentity))
  const introduced = extensionPanelShortcutConflicts(next).find(
    (conflict) => !existing.has(conflictIdentity(conflict)),
  )
  if (introduced === undefined) return null
  const panelAlreadyHeldKey =
    introduced.owner.kind !== 'reserved' &&
    panelBindingKey(current.bindings, introduced.surfaceId) === introduced.key
  if (panelAlreadyHeldKey) {
    return `Shortcut ${introduced.key} is used by ${extensionPanelFallbackLabel(introduced.surfaceId)}. Clear that panel's shortcut first.`
  }
  return `Shortcut ${introduced.key} is already assigned to ${introduced.owner.label}.`
}
