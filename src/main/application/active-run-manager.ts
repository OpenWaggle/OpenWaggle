interface ActiveRunEntry<M> {
  readonly controller: AbortController
  readonly metadata: M
  readonly settled: Promise<void>
}

/** Application-owned registry for cancellable work keyed by a domain identifier. */
export class ActiveRunManager<K, M> {
  private readonly runs = new Map<K, ActiveRunEntry<M>>()
  private readonly settleRun = new WeakMap<AbortController, () => void>()
  /**
   * Controllers removed from the active slot by cancellation/replacement but
   * whose owning Effect has not reached its ensuring cleanup yet.
   */
  private readonly settling = new Map<K, Map<AbortController, ActiveRunEntry<M>>>()

  private markSettling(key: K, entry: ActiveRunEntry<M>) {
    const entries = this.settling.get(key) ?? new Map<AbortController, ActiveRunEntry<M>>()
    entries.set(entry.controller, entry)
    this.settling.set(key, entries)
  }

  private removeSettling(key: K, controller: AbortController) {
    const entries = this.settling.get(key)
    if (entries === undefined) return false
    const removed = entries.delete(controller)
    if (entries.size === 0) this.settling.delete(key)
    return removed
  }

  register(key: K, controller: AbortController, metadata: M) {
    const existing = this.runs.get(key)
    if (existing?.controller === controller) {
      this.runs.set(key, { ...existing, metadata })
      return
    }
    if (existing !== undefined && existing.controller !== controller) {
      this.markSettling(key, existing)
    }
    let settle: () => void = () => undefined
    const settled = new Promise<void>((resolve) => {
      settle = resolve
    })
    this.settleRun.set(controller, settle)
    this.runs.set(key, { controller, metadata, settled })
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

  async interruptAndWait(key: K, matches: (metadata: M) => boolean) {
    const entry = this.runs.get(key)
    if (!entry || !matches(entry.metadata)) return false
    entry.controller.abort()
    await entry.settled
    return true
  }

  requestInterrupt(key: K, matches: (metadata: M) => boolean) {
    const entry = this.runs.get(key)
    if (!entry || !matches(entry.metadata)) return false
    entry.controller.abort()
    return true
  }

  cancelAll(predicate?: (entry: ActiveRunEntry<M>, key: K) => boolean) {
    for (const [key, entries] of this.settling) {
      for (const [controller, entry] of entries) {
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
    const entry = this.runs.get(key)
    if (!entry) return false
    this.runs.delete(key)
    this.settle(entry.controller)
    return true
  }

  isCurrent(key: K, controller: AbortController) {
    return this.runs.get(key)?.controller === controller
  }

  deleteIfCurrent(key: K, controller: AbortController) {
    const current = this.isCurrent(key, controller)
    if (current) this.runs.delete(key)
    this.removeSettling(key, controller)
    this.settle(controller)
    return current
  }

  keys() {
    return this.runs.keys()
  }

  unsettledKeys() {
    return new Set([...this.runs.keys(), ...this.settling.keys()]).keys()
  }

  private settle(controller: AbortController) {
    const settle = this.settleRun.get(controller)
    if (!settle) return
    this.settleRun.delete(controller)
    settle()
  }
}
