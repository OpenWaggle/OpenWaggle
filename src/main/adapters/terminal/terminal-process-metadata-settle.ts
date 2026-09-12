import { TERMINAL_SPAWN_PROCESS_METADATA_MS } from './terminal-process-identity'
import type { LiveTerminalProcess } from './terminal-records'

/** Settle the one bounded spawn probe before shutdown relies on PID ancestry. */
export async function settleLiveProcessMetadata(live: LiveTerminalProcess) {
  let timer: NodeJS.Timeout | null = null
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), TERMINAL_SPAWN_PROCESS_METADATA_MS)
  })
  const metadata = await Promise.race([live.processMetadata.catch(() => null), timedOut])
  if (timer !== null) clearTimeout(timer)
  if (
    metadata === null ||
    metadata.pid !== live.pid ||
    live.processIdentity?.startedAt !== metadata.startedAt ||
    live.ttyIdentity !== metadata.ttyIdentity
  ) {
    return
  }
  if (live.tty === null) live.tty = metadata.tty
}
