import { BUILT_IN_COMPOSER_SLASH_COMMAND } from './built-in-slash-commands'

export type SessionCopyCommand = { readonly type: 'fork' } | { readonly type: 'clone' }

export function parseSessionCopyCommand(input: string): SessionCopyCommand | null {
  const trimmed = input.trim()
  if (trimmed === BUILT_IN_COMPOSER_SLASH_COMMAND.FORK) {
    return { type: 'fork' }
  }
  if (trimmed === BUILT_IN_COMPOSER_SLASH_COMMAND.CLONE) {
    return { type: 'clone' }
  }
  return null
}
