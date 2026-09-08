interface ActiveRunEntry<M> {
  readonly controller: AbortController
  readonly metadata: M
}

/** Application-owned registry for cancellable work keyed by a domain identifier. */
export class ActiveRunManager<K, M> {
  private readonly runs = new Map<K, ActiveRunEntry<M>>()
  /**
   * Controllers removed from the active slot by cancellation/replacement but
   * whose owning Effect has not reached its ensuring cleanup yet.
   */
  private readonly settling = new Map<K, Map<AbortController, M>>()

  private markSettling(key: K, entry: ActiveRunEntry<M>) {
    const entries = this.settling.get(key) ?? new Map<AbortController, M>()
    entries.set(entry.controller, entry.metadata)
    this.settling.set(key, entries)
  }

  private settle(key: K, controller: AbortController) {
    const entries = this.settling.get(key)
    if (entries === undefined) return false
    const removed = entries.delete(controller)
    if (entries.size === 0) this.settling.delete(key)
    return removed
  }

  register(key: K, controller: AbortController, metadata: M) {
    const existing = this.runs.get(key)
    if (existing !== undefined && existing.controller !== controller) {
      this.markSettling(key, existing)
    }
    this.runs.set(key, { controller, metadata })
  }

  get(key: K) {
    return this.runs.get(key)
  }

  has(key: K) {
    return this.runs.has(key)
  }

  /** True until both the current run and every cancelled/replaced run settle. */
  hasUnsettled(key: K) {
    return this.runs.has(key) || (this.settling.get(key)?.size ?? 0) > 0
  }

  cancel(key: K) {
    const entry = this.runs.get(key)
    if (!entry) return false
    this.markSettling(key, entry)
    this.runs.delete(key)
    entry.controller.abort()
    return true
  }

  cancelAll(predicate?: (entry: ActiveRunEntry<M>, key: K) => boolean) {
    for (const [key, entries] of this.settling) {
      for (const [controller, metadata] of entries) {
        const entry = { controller, metadata }
        if ((!predicate || predicate(entry, key)) && !controller.signal.aborted) controller.abort()
      }
    }
    for (const [key, entry] of this.runs) {
      if (!predicate || predicate(entry, key)) {
        this.markSettling(key, entry)
        this.runs.delete(key)
        entry.controller.abort()
      }
    }
  }

  delete(key: K) {
    this.runs.delete(key)
  }

  isCurrent(key: K, controller: AbortController) {
    return this.runs.get(key)?.controller === controller
  }

  deleteIfCurrent(key: K, controller: AbortController) {
    if (this.isCurrent(key, controller)) {
      this.runs.delete(key)
      return true
    }
    this.settle(key, controller)
    return false
  }

  keys() {
    return this.runs.keys()
  }
}
