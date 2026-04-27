interface ActiveRunEntry<M> {
  readonly controller: AbortController
  readonly metadata: M
}

/**
 * Generic active run tracker that unifies the pattern of registering,
 * cancelling, and looking up in-flight operations keyed by an identifier.
 *
 * Metadata is returned by reference from `get()` so callers can mutate
 * fields in place (e.g. updating `collector` or `model` mid-run).
 */
export class ActiveRunManager<K, M> {
  private readonly runs = new Map<K, ActiveRunEntry<M>>()

  register(key: K, controller: AbortController, metadata: M): void {
    this.runs.set(key, { controller, metadata })
  }

  get(key: K): ActiveRunEntry<M> | undefined {
    return this.runs.get(key)
  }

  has(key: K): boolean {
    return this.runs.has(key)
  }

  /** Abort and remove the entry. Returns true if the entry existed. */
  cancel(key: K): boolean {
    const entry = this.runs.get(key)
    if (!entry) return false
    entry.controller.abort()
    this.runs.delete(key)
    return true
  }

  /** Cancel all entries matching the predicate, or all entries if no predicate. */
  cancelAll(predicate?: (entry: ActiveRunEntry<M>, key: K) => boolean): void {
    for (const [key, entry] of this.runs) {
      if (!predicate || predicate(entry, key)) {
        entry.controller.abort()
        this.runs.delete(key)
      }
    }
  }

  /** Remove without aborting. */
  delete(key: K): void {
    this.runs.delete(key)
  }

  isCurrent(key: K, controller: AbortController): boolean {
    return this.runs.get(key)?.controller === controller
  }

  deleteIfCurrent(key: K, controller: AbortController): boolean {
    if (!this.isCurrent(key, controller)) {
      return false
    }
    this.runs.delete(key)
    return true
  }

  keys(): IterableIterator<K> {
    return this.runs.keys()
  }
}
