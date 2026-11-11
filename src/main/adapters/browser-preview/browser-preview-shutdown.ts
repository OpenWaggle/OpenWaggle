/** A native preview, as shutdown sees it. */
interface BrowserPreviewShutdownRecord {
  readonly ownerKey: string
}

/** Tracks native lifetime independently of the renderer-visible preview registry. */
export class BrowserPreviewShutdown<Preview extends BrowserPreviewShutdownRecord> {
  private readonly records = new Set<Preview>()
  private readonly closing = new Map<Preview, Promise<void>>()
  private readonly closingOwners = new Map<string, Promise<void>>()
  private shuttingDown = false

  private readonly closeRecord: (record: Preview) => Promise<void>
  private readonly whenDestroyed: (record: Preview, listener: () => void) => void

  /**
   * `closeRecord` closes a preview and resolves once its native view is gone; `whenDestroyed`
   * calls back once when the shell destroys the view for any reason.
   */
  constructor(
    closeRecord: (record: Preview) => Promise<void>,
    whenDestroyed: (record: Preview, listener: () => void) => void,
  ) {
    this.closeRecord = closeRecord
    this.whenDestroyed = whenDestroyed
  }

  assertCanOpen(ownerKey: string) {
    if (this.shuttingDown) throw new Error('Browser previews are shutting down.')
    if (this.closingOwners.has(ownerKey)) throw new Error('Browser previews are closing.')
  }

  track(record: Preview) {
    this.records.add(record)
    this.whenDestroyed(record, () => this.records.delete(record))
  }

  beginShutdown() {
    this.shuttingDown = true
  }

  closeForOwner(ownerKey: string) {
    const existing = this.closingOwners.get(ownerKey)
    if (existing) return existing
    const completion = Promise.withResolvers<void>()
    this.closingOwners.set(ownerKey, completion.promise)
    void this.closeRecords([...this.records].filter((r) => r.ownerKey === ownerKey))
      .finally(() => this.closingOwners.delete(ownerKey))
      .then(completion.resolve, completion.reject)
    return completion.promise
  }

  closeAll() {
    this.beginShutdown()
    return this.closeRecords([...this.records])
  }

  private async closeRecords(records: readonly Preview[]) {
    const results = await Promise.allSettled(records.map((record) => this.close(record)))
    const failures = results.flatMap((result) => {
      if (result.status !== 'rejected') return []
      const cause: unknown = result.reason
      return [cause]
    })
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) {
      throw new AggregateError(failures, 'Browser previews could not all be closed.', {
        cause: failures[0],
      })
    }
  }

  private close(record: Preview) {
    const existing = this.closing.get(record)
    if (existing) return existing
    const operation = this.closeRecord(record)
      .then(() => this.records.delete(record))
      .finally(() => this.closing.delete(record))
      .then(() => undefined)
    this.closing.set(record, operation)
    return operation
  }
}
