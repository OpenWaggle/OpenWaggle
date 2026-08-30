interface ActiveRunEntry<M> {
  readonly controller: AbortController
  readonly metadata: M
  readonly settled: Promise<void>
}

/** Application-owned registry for cancellable work keyed by a domain identifier. */
export class ActiveRunManager<K, M> {
  private readonly runs = new Map<K, ActiveRunEntry<M>>()
  private readonly settleRun = new WeakMap<AbortController, () => void>()

  register(key: K, controller: AbortController, metadata: M) {
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

  cancel(key: K) {
    const entry = this.runs.get(key)
    if (!entry) return false
    entry.controller.abort()
    this.runs.delete(key)
    return true
  }

  async interruptAndWait(key: K, matches: (metadata: M) => boolean) {
    const entry = this.runs.get(key)
    if (!entry || !matches(entry.metadata)) return false
    entry.controller.abort()
    await entry.settled
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
    this.settle(controller)
    return current
  }

  keys() {
    return this.runs.keys()
  }

  private settle(controller: AbortController) {
    const settle = this.settleRun.get(controller)
    if (!settle) return
    this.settleRun.delete(controller)
    settle()
  }
}
