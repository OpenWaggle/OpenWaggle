const pendingByOwner = new Map<string, Set<Promise<void>>>()
const OWNER_QUIESCE_TIMEOUT_MS = 10_000

/** Track direct requests too, not only requests admitted by the IPC queue. */
export function trackBrowserPreviewOwnerWork<T>(ownerKey: string, operation: () => Promise<T>) {
  const work = operation()
  const settled = work.then(
    () => undefined,
    () => undefined,
  )
  const pending = pendingByOwner.get(ownerKey) ?? new Set<Promise<void>>()
  pending.add(settled)
  pendingByOwner.set(ownerKey, pending)
  return work.finally(() => {
    pending.delete(settled)
    if (pending.size === 0 && pendingByOwner.get(ownerKey) === pending)
      pendingByOwner.delete(ownerKey)
  })
}

/** Called after closing admission, before any destructive owner migration. */
export async function drainBrowserPreviewOwnerWork(ownerKey: string, queue?: Promise<void>) {
  const work = [...(pendingByOwner.get(ownerKey) ?? [])]
  if (queue !== undefined) work.push(queue)
  if (work.length === 0) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.allSettled(work),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error('Browser tabs are still opening. Draft workspace tabs were not moved.'),
            ),
          OWNER_QUIESCE_TIMEOUT_MS,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
