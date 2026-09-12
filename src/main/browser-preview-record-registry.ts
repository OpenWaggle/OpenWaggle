import type { Event, WebContents, WebContentsDidStartNavigationEventParams } from 'electron'
import type { BrowserPreviewOwnerRecord, BrowserPreviewRecord } from './browser-preview-records'
import { browserWindowFromWebContents } from './desktop-ui'
import { isTrustedRendererDocument } from './renderer-document-trust'

const MAX_PENDING_SELECTIONS = 64

interface BrowserPreviewRecordRegistryOptions {
  readonly disposeRecord: (record: BrowserPreviewRecord) => void
}

function attemptRegistryCleanup(action: () => void) {
  try {
    action()
  } catch {
    // Continue tearing down all records after an Electron listener race.
  }
}

export class BrowserPreviewRecordRegistry {
  private readonly owners = new Map<number, BrowserPreviewOwnerRecord>()
  private readonly retiringOwners = new Set<BrowserPreviewOwnerRecord>()
  private readonly recordsByOwnerKey = new Map<string, Map<string, BrowserPreviewRecord>>()
  private readonly currentByOwnerKey = new Map<string, BrowserPreviewRecord>()
  private readonly pendingByOwnerKey = new Map<
    string,
    {
      readonly sender: WebContents
      readonly previewId: string
    }
  >()

  constructor(private readonly options: BrowserPreviewRecordRegistryOptions) {}

  findOwned(ownerKey: string, previewId?: string): BrowserPreviewRecord | undefined {
    if (previewId !== undefined) {
      const record = this.recordsByOwnerKey.get(ownerKey)?.get(previewId)
      return record && this.isLive(record) ? record : undefined
    }
    if (this.pendingByOwnerKey.has(ownerKey)) return undefined
    const current = this.currentByOwnerKey.get(ownerKey)
    if (current && this.isLive(current)) return current
    const previews = this.listOwned(ownerKey)
    return previews.length === 1 ? previews[0] : undefined
  }

  listOwned(ownerKey: string): readonly BrowserPreviewRecord[] {
    return [...(this.recordsByOwnerKey.get(ownerKey)?.values() ?? [])].filter((record) =>
      this.isLive(record),
    )
  }

  countOwned(ownerKey: string): number {
    return this.recordsByOwnerKey.get(ownerKey)?.size ?? 0
  }

  countForRenderer(sender: WebContents): number {
    const owner = this.owners.get(sender.id)
    return owner?.sender === sender ? owner.previews.size : 0
  }

  getOrCreateOwner(sender: WebContents): BrowserPreviewOwnerRecord {
    const existing = this.owners.get(sender.id)
    if (existing) {
      if (existing.sender !== sender) throw new Error('Browser preview owner identity changed.')
      if (this.retiringOwners.has(existing))
        throw new Error('Browser preview owner cleanup is pending.')
      return existing
    }
    if (sender.isDestroyed()) throw new Error('Browser preview owner has been destroyed.')
    const window = browserWindowFromWebContents(sender)
    if (!window || window.isDestroyed()) {
      throw new Error('Browser previews require a live owner window.')
    }
    const owner: BrowserPreviewOwnerRecord = {
      sender,
      window,
      previews: new Map<string, BrowserPreviewRecord>(),
      shortcutBindings: [],
      removeListeners: [],
    }
    this.owners.set(sender.id, owner)
    const dispose = () => this.disposeOwner(owner)
    const onNavigation = (details: Event<WebContentsDidStartNavigationEventParams>) => {
      if (
        details.isMainFrame &&
        !details.isSameDocument &&
        !isTrustedRendererDocument(details.url)
      ) {
        dispose()
      }
    }
    sender.once('destroyed', dispose)
    sender.once('render-process-gone', dispose)
    sender.on('did-start-navigation', onNavigation)
    window.once('closed', dispose)
    owner.removeListeners.push(
      () => sender.removeListener('destroyed', dispose),
      () => sender.removeListener('render-process-gone', dispose),
      () => sender.removeListener('did-start-navigation', onNavigation),
      () => window.removeListener('closed', dispose),
    )
    return owner
  }

  requireOwner(sender: WebContents): BrowserPreviewOwnerRecord {
    const owner = this.owners.get(sender.id)
    if (!owner || owner.sender !== sender) throw new Error('Browser preview owner was not found.')
    if (this.retiringOwners.has(owner)) throw new Error('Browser preview owner cleanup is pending.')
    return owner
  }

  requirePreview(sender: WebContents, previewId: string): BrowserPreviewRecord {
    const record = this.requireOwner(sender).previews.get(previewId)
    if (!record || record.disposed) throw new Error(`Browser preview "${previewId}" was not found.`)
    return record
  }

  findForRenderer(sender: WebContents, previewId: string): BrowserPreviewRecord | undefined {
    const owner = this.owners.get(sender.id)
    const record = owner?.sender === sender ? owner.previews.get(previewId) : undefined
    return record && this.isLive(record) ? record : undefined
  }

  findForDisposal(sender: WebContents, previewId: string): BrowserPreviewRecord | undefined {
    const owner = this.owners.get(sender.id)
    const owned = owner?.sender === sender ? owner.previews.get(previewId) : undefined
    if (owned) return owned
    for (const owner of this.owners.values()) {
      if (owner.previews.has(previewId)) {
        throw new Error('Browser preview is not owned by this renderer.')
      }
    }
    return undefined
  }

  add(record: BrowserPreviewRecord): void {
    const existing = this.recordsByOwnerKey.get(record.ownerKey)?.get(record.previewId)
    if (existing !== undefined) {
      throw new Error(`Browser preview "${record.previewId}" is already owned by this session.`)
    }
    record.owner.previews.set(record.previewId, record)
    const previews =
      this.recordsByOwnerKey.get(record.ownerKey) ?? new Map<string, BrowserPreviewRecord>()
    previews.set(record.previewId, record)
    this.recordsByOwnerKey.set(record.ownerKey, previews)
    this.markCurrent(record)
  }

  setCurrent(
    sender: WebContents,
    ownerKey: string,
    previewId: string | null,
  ): BrowserPreviewRecord | undefined {
    if (previewId === null) {
      this.pendingByOwnerKey.delete(ownerKey)
      this.currentByOwnerKey.delete(ownerKey)
      return undefined
    }
    const record = this.getOrCreateOwner(sender).previews.get(previewId)
    if (record === undefined) {
      if (
        !this.pendingByOwnerKey.has(ownerKey) &&
        this.pendingByOwnerKey.size >= MAX_PENDING_SELECTIONS
      ) {
        throw new Error('Too many browser selections are waiting for native creation.')
      }
      this.pendingByOwnerKey.set(ownerKey, { sender, previewId })
      return undefined
    }
    if (record.ownerKey !== ownerKey) {
      throw new Error(`Browser preview "${previewId}" is not owned by this session.`)
    }
    this.pendingByOwnerKey.delete(ownerKey)
    this.currentByOwnerKey.set(ownerKey, record)
    return record
  }

  markCurrent(record: BrowserPreviewRecord): void {
    if (!this.isLive(record)) throw new Error('Browser preview is no longer available.')
    const pending = this.pendingByOwnerKey.get(record.ownerKey)
    if (pending !== undefined) {
      if (pending.sender !== record.owner.sender || pending.previewId !== record.previewId) return
      this.pendingByOwnerKey.delete(record.ownerKey)
    }
    this.currentByOwnerKey.set(record.ownerKey, record)
  }

  forgetSelection(sender: WebContents, ownerKey: string): void {
    if (this.pendingByOwnerKey.get(ownerKey)?.sender === sender)
      this.pendingByOwnerKey.delete(ownerKey)
    if (this.currentByOwnerKey.get(ownerKey)?.owner.sender === sender)
      this.currentByOwnerKey.delete(ownerKey)
  }

  remove(record: BrowserPreviewRecord): void {
    record.owner.previews.delete(record.previewId)
    if (record.owner.previews.size === 0 && this.retiringOwners.delete(record.owner)) {
      if (this.owners.get(record.owner.sender.id) === record.owner) {
        this.owners.delete(record.owner.sender.id)
      }
    }
    const previews = this.recordsByOwnerKey.get(record.ownerKey)
    if (!previews || previews.get(record.previewId) !== record) return
    previews.delete(record.previewId)
    if (previews.size === 0) {
      this.recordsByOwnerKey.delete(record.ownerKey)
      this.currentByOwnerKey.delete(record.ownerKey)
      return
    }
    if (this.currentByOwnerKey.get(record.ownerKey) === record) {
      let fallback: BrowserPreviewRecord | undefined
      for (const candidate of previews.values()) fallback = candidate
      if (fallback) this.currentByOwnerKey.set(record.ownerKey, fallback)
    }
  }

  isLive(record: BrowserPreviewRecord): boolean {
    return (
      !record.disposed &&
      !this.retiringOwners.has(record.owner) &&
      record.owner.previews.get(record.previewId) === record
    )
  }

  disposeOwner(owner: BrowserPreviewOwnerRecord): void {
    if (this.owners.get(owner.sender.id) !== owner) return
    if (this.retiringOwners.has(owner)) return
    this.retiringOwners.add(owner)
    for (const [ownerKey, pending] of this.pendingByOwnerKey) {
      if (pending.sender === owner.sender) this.pendingByOwnerKey.delete(ownerKey)
    }
    for (const removeListener of owner.removeListeners.splice(0)) {
      attemptRegistryCleanup(removeListener)
    }
    for (const record of [...owner.previews.values()]) {
      attemptRegistryCleanup(() => this.options.disposeRecord(record))
    }
    if (owner.previews.size === 0) {
      this.retiringOwners.delete(owner)
      if (this.owners.get(owner.sender.id) === owner) this.owners.delete(owner.sender.id)
    }
  }
}
