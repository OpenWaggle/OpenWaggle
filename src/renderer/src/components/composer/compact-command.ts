export interface CompactCommand {
  readonly customInstructions?: string
}

const COMPACT_COMMAND = '/compact'

export function parseCompactCommand(text: string): CompactCommand | null {
  const trimmed = text.trim()
  if (trimmed === COMPACT_COMMAND) {
    return {}
  }
  if (!trimmed.startsWith(`${COMPACT_COMMAND} `)) {
    return null
  }

  const customInstructions = trimmed.slice(COMPACT_COMMAND.length).trim()
  return customInstructions ? { customInstructions } : {}
}

export function compactCommandText(customInstructions?: string): string {
  const trimmed = customInstructions?.trim()
  return trimmed ? `${COMPACT_COMMAND} ${trimmed}` : COMPACT_COMMAND
}
