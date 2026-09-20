import type { Socket } from 'node:net'

const DEFAULT_PROFILE_ADMISSION_DRAIN_TIMEOUT_MS = 1000
const DEFAULT_PROFILE_INVALIDATION_CLOSE_TIMEOUT_MS = 1000

export async function drainLocalSessionProfileAdmission(
  drained: Promise<void>,
  timeoutMs = DEFAULT_PROFILE_ADMISSION_DRAIN_TIMEOUT_MS,
  timedOut: () => void,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const result = await Promise.race([
    drained.then(() => 'drained' as const),
    new Promise<'timed-out'>((resolve) => {
      timeout = setTimeout(() => resolve('timed-out'), timeoutMs)
      timeout.unref?.()
    }),
  ])
  if (timeout) clearTimeout(timeout)
  if (result === 'drained') return
  timedOut()
  await drained
}

export class LocalSessionInvalidationCloser {
  private timer: ReturnType<typeof setTimeout> | undefined

  disconnect(socket: Socket, timeoutMs = DEFAULT_PROFILE_INVALIDATION_CLOSE_TIMEOUT_MS): void {
    socket.end()
    if (this.timer) return
    this.timer = setTimeout(() => socket.destroy(), timeoutMs)
    this.timer.unref?.()
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }
}
