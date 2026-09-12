import type { BrowserPreviewRecord } from './browser-preview-records'

/** Tracks native lifetime independently of the renderer-visible preview registry. */
export class BrowserPreviewShutdown {
  private readonly records = new Set<BrowserPreviewRecord>()
  private readonly closing = new Map<BrowserPreviewRecord, Promise<void>>()
  private readonly closingOwners = new Map<string, Promise<void>>()
  private shuttingDown = false

  constructor(private readonly closeRecord: (record: BrowserPreviewRecord) => Promise<void>) {}

  assertCanOpen(ownerKey: string): void {
    if (this.shuttingDown) throw new Error('Browser previews are shutting down.')
    if (this.closingOwners.has(ownerKey)) throw new Error('Browser previews are closing.')
  }

  track(record: BrowserPreviewRecord): void {
    this.records.add(record)
    record.view.webContents.once('destroyed', () => this.records.delete(record))
  }

  beginShutdown(): void {
    this.shuttingDown = true
  }

  closeForOwner(ownerKey: string): Promise<void> {
    const existing = this.closingOwners.get(ownerKey)
    if (existing) return existing
    const completion = Promise.withResolvers<void>()
    this.closingOwners.set(ownerKey, completion.promise)
    void this.closeRecords([...this.records].filter((r) => r.ownerKey === ownerKey))
      .finally(() => this.closingOwners.delete(ownerKey))
      .then(completion.resolve, completion.reject)
    return completion.promise
  }

  closeAll(): Promise<void> {
    this.beginShutdown()
    return this.closeRecords([...this.records])
  }

  private async closeRecords(records: readonly BrowserPreviewRecord[]): Promise<void> {
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

  private close(record: BrowserPreviewRecord): Promise<void> {
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
