import { app } from 'electron'

interface DesktopInstanceLock {
  readonly hasSingleInstanceLock: () => boolean
  readonly requestSingleInstanceLock: () => boolean
  readonly releaseSingleInstanceLock: () => void
}

export async function withLegacySessionWriterFence<T>(
  operation: () => Promise<T>,
  lock: DesktopInstanceLock = app,
): Promise<T> {
  const alreadyOwned = lock.hasSingleInstanceLock()
  if (!alreadyOwned && !lock.requestSingleInstanceLock()) {
    throw new Error(
      'Session Host migration requires exclusive desktop ownership. Close the running OpenWaggle window and retry.',
    )
  }
  try {
    return await operation()
  } finally {
    if (!alreadyOwned) lock.releaseSingleInstanceLock()
  }
}
