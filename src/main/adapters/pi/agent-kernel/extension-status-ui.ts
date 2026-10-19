import { stripVTControlCharacters } from 'node:util'
import type { AgentExtensionStatusSlot, AgentTransportEvent } from '@shared/types/stream'

/**
 * Status text as one plain line. Pi TUI extensions style it with ANSI colors (`theme.fg`) and the
 * footer shows one line; blank text clears the status, as Pi's footer drops it.
 */
function plainStatusText(text: string | undefined) {
  if (text === undefined) return undefined
  const plain = stripVTControlCharacters(text).replace(/\s+/g, ' ').trim()
  return plain.length > 0 ? plain : undefined
}

/** Pi's footer status and working message reach the renderer as live `extension_status` events. */
export function emitExtensionStatus(
  context: {
    readonly runId: string
    readonly onEvent: (event: AgentTransportEvent) => void
  },
  slot: AgentExtensionStatusSlot,
  text: string | undefined,
) {
  const plain = plainStatusText(text)
  context.onEvent({
    type: 'extension_status',
    runId: context.runId,
    slot,
    ...(plain !== undefined ? { text: plain } : {}),
    timestamp: Date.now(),
  })
}
