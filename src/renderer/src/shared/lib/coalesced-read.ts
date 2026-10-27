/**
 * Shares one read between callers asking for the same thing (boot fetch dedupe, v1 performance).
 *
 * Startup and Session switches fire the same read from several places in one turn: the Session
 * catalog from the chat and the sidebar stores, the pins from the catalog and the pin store. Calls
 * made in the same task as the read that is in flight join it. A call made later, while it is
 * still in flight, may reflect a change made since it started, so it gets one trailing read that
 * every later caller shares; a read never answers with data older than the call that asked.
 */
export function coalescedRead<T>(read: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null
  let joinable = false
  let trailing: Promise<T> | null = null

  function start(): Promise<T> {
    const promise = read()
    inFlight = promise
    joinable = true
    queueMicrotask(() => {
      joinable = false
    })
    const settle = () => {
      if (inFlight === promise) inFlight = null
    }
    promise.then(settle, settle)
    return promise
  }

  return () => {
    if (!inFlight) return start()
    if (joinable) return inFlight
    if (!trailing) {
      const restart = () => {
        trailing = null
        return start()
      }
      trailing = inFlight.then(restart, restart)
    }
    return trailing
  }
}

/**
 * {@link coalescedRead} for each key, such as one Git status read per working path. Keys are few
 * (paths, Sessions) and an idle reader holds nothing, so readers are kept.
 */
export function keyedCoalescedRead<K, T>(read: (key: K) => Promise<T>): (key: K) => Promise<T> {
  const readers = new Map<K, () => Promise<T>>()
  return (key) => {
    let reader = readers.get(key)
    if (!reader) {
      reader = coalescedRead(() => read(key))
      readers.set(key, reader)
    }
    return reader()
  }
}
