import { BUILT_IN_COMPOSER_SLASH_COMMAND } from './built-in-slash-commands'

export interface CompactCommand {
  readonly customInstructions?: string
}

const COMPACT_COMMAND = BUILT_IN_COMPOSER_SLASH_COMMAND.COMPACT

export function parseCompactCommand(text: string) {
  const trimmed = text.trim()
  if (trimmed === COMPACT_COMMAND) {
    const command: CompactCommand | null = {}
    return command
  }
  if (!trimmed.startsWith(`${COMPACT_COMMAND} `)) {
    return null
  }

  const customInstructions = trimmed.slice(COMPACT_COMMAND.length).trim()
  const command: CompactCommand | null = customInstructions ? { customInstructions } : {}
  return command
}
