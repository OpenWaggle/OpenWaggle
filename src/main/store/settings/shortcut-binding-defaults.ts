import {
  isMandatoryShortcutCommand,
  SHORTCUT_COMMANDS,
  type ShortcutBinding,
  type ShortcutCommand,
  shortcutBindingKey,
  shortcutScopesOverlap,
} from '@shared/types/shortcuts'

/**
 * A command added after the record was saved gets its default, unless the user already gave
 * that chord to another command: then the new command starts unassigned instead of the whole
 * record falling back to the defaults below.
 */
export function dropAddedDefaultsTakenByTheUser(
  raw: Readonly<Record<string, unknown>>,
  result: Record<ShortcutCommand, ShortcutBinding | null>,
) {
  const saved = SHORTCUT_COMMANDS.filter((command) => raw[command] !== undefined)
  for (const command of SHORTCUT_COMMANDS) {
    const binding = result[command]
    if (raw[command] !== undefined || binding === null || isMandatoryShortcutCommand(command)) {
      continue
    }
    const taken = saved.some((other) => {
      const otherBinding = result[other]
      return (
        otherBinding !== null &&
        shortcutBindingKey(otherBinding) === shortcutBindingKey(binding) &&
        shortcutScopesOverlap(command, other)
      )
    })
    if (taken) result[command] = null
  }
}
