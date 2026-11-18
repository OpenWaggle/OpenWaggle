export class LocalSessionAdmissionGate {
  private refreshTail = Promise.resolve()
  private epoch = 0
  private fenceDepth = 0
  private fenced = false
  private readers = 0
  private ready = Promise.resolve()
  private releaseReady: (() => void) | null = null
  private readonly drainWaiters = new Set<() => void>()

  isFenced() {
    return this.fenced
  }

  hasFence() {
    return this.fenceDepth > 0
  }

  currentEpoch() {
    return this.epoch
  }

  fence() {
    this.fenceDepth += 1
    if (!this.fenced) {
      this.fenced = true
      this.epoch += 1
      this.ready = new Promise<void>((resolve) => {
        this.releaseReady = resolve
      })
    }
    return this.waitForReaders()
  }

  waitForReaders() {
    if (this.readers === 0) return Promise.resolve()
    return new Promise<void>((resolve) => this.drainWaiters.add(resolve))
  }

  releaseFence() {
    if (this.fenceDepth > 0) this.fenceDepth -= 1
    if (!this.fenced || this.fenceDepth > 0) return
    this.fenced = false
    this.epoch += 1
    this.releaseReady?.()
    this.releaseReady = null
  }

  acquireReader(closed: boolean) {
    if (this.fenced || closed) return undefined
    this.readers += 1
    let released = false
    return () => {
      if (released) return
      released = true
      this.readers = Math.max(0, this.readers - 1)
      if (this.readers !== 0) return
      for (const resolve of this.drainWaiters) resolve()
      this.drainWaiters.clear()
    }
  }

  enqueueRefresh(refresh: () => Promise<void>) {
    this.refreshTail = this.refreshTail.then(refresh, refresh)
    return this.refreshTail
  }

  async waitUntilReady() {
    await this.refreshTail
    await this.ready
  }

  close() {
    this.fenceDepth = 0
    this.releaseFence()
    this.fenced = false
    this.releaseReady?.()
    this.releaseReady = null
    this.readers = 0
    for (const resolve of this.drainWaiters) resolve()
    this.drainWaiters.clear()
  }
}
