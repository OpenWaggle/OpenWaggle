interface ActiveRunEntry<M> {
  readonly controller: AbortController
  readonly metadata: M
}

/** Application-owned registry for cancellable work keyed by a domain identifier. */
export class ActiveRunManager<K, M> {
  private readonly runs = new Map<K, ActiveRunEntry<M>>()

  register(key: K, controller: AbortController, metadata: M) {
    this.runs.set(key, { controller, metadata })
  }

  get(key: K) {
    return this.runs.get(key)
  }

  has(key: K) {
    return this.runs.has(key)
  }

  cancel(key: K) {
    const entry = this.runs.get(key)
    if (!entry) return false
    entry.controller.abort()
    this.runs.delete(key)
    return true
  }

  cancelAll(predicate?: (entry: ActiveRunEntry<M>, key: K) => boolean) {
    for (const [key, entry] of this.runs) {
      if (!predicate || predicate(entry, key)) {
        entry.controller.abort()
        this.runs.delete(key)
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
    if (!this.isCurrent(key, controller)) return false
    this.runs.delete(key)
    return true
  }

  keys() {
    return this.runs.keys()
  }
}
