import type { BrowserPreviewOwnerWindow } from './browser-preview-owner-registry'
import type {
  RendererSurface,
  RendererSurfaceNavigationStart,
} from '../../ports/desktop-shell/renderer-surfaces'
import { isTrustedRendererDocument } from '../../renderer-document-trust'

const MAX_PENDING_SELECTIONS = 64

/** The renderer page that owns previews, as the registry sees it. */
export interface BrowserPreviewRegistryOwner<Surface extends RendererSurface, Preview> {
  readonly sender: Surface
  readonly previews: Map<string, Preview>
  readonly removeListeners: (() => void)[]
}

/** One preview, as the registry sees it. */
export interface BrowserPreviewRegistryRecord<Owner> {
  readonly previewId: string
  readonly ownerKey: string
  readonly owner: Owner
  readonly disposed: boolean
}

interface BrowserPreviewRecordRegistryOptions<Surface extends RendererSurface, Owner, Preview> {
  readonly disposeRecord: (record: Preview) => void
  /** The owner page's window, `null` when it has none or it closed. */
  readonly ownerWindowOf: (sender: Surface) => BrowserPreviewOwnerWindow | null
  readonly createOwner: (sender: Surface) => Owner
}

function attemptRegistryCleanup(action: () => void) {
  try {
    action()
  } catch {
    // Continue tearing down all records after a shell listener race.
  }
}

/**
 * Owner pages, the previews each Session owner key holds, and each owner's current preview. Shared
 * by the shells: a shell supplies how to find an owner page's window and how to create its owner
 * record.
 */
export class BrowserPreviewRecordRegistry<
  Surface extends RendererSurface,
  Owner extends BrowserPreviewRegistryOwner<Surface, Preview>,
  Preview extends BrowserPreviewRegistryRecord<Owner>,
> {
  private readonly owners = new Map<number, Owner>()
  private readonly retiringOwners = new Set<Owner>()
  private readonly recordsByOwnerKey = new Map<string, Map<string, Preview>>()
  private readonly currentByOwnerKey = new Map<string, Preview>()
  private readonly pendingByOwnerKey = new Map<
    string,
    {
      readonly sender: Surface
      readonly previewId: string
    }
  >()

  private readonly options: BrowserPreviewRecordRegistryOptions<Surface, Owner, Preview>

  constructor(options: BrowserPreviewRecordRegistryOptions<Surface, Owner, Preview>) {
    this.options = options
  }

  findOwned(ownerKey: string, previewId?: string) {
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

  listOwned(ownerKey: string) {
    return [...(this.recordsByOwnerKey.get(ownerKey)?.values() ?? [])].filter((record) =>
      this.isLive(record),
    )
  }

  countOwned(ownerKey: string) {
    return this.recordsByOwnerKey.get(ownerKey)?.size ?? 0
  }

  countForRenderer(sender: Surface) {
    const owner = this.owners.get(sender.id)
    return owner?.sender === sender ? owner.previews.size : 0
  }

  getOrCreateOwner(sender: Surface) {
    const existing = this.owners.get(sender.id)
    if (existing) {
      if (existing.sender !== sender) throw new Error('Browser preview owner identity changed.')
      if (this.retiringOwners.has(existing)) {
        throw new Error('Browser preview owner cleanup is pending.')
      }
      return existing
    }
    if (sender.isDestroyed()) throw new Error('Browser preview owner has been destroyed.')
    const window = this.options.ownerWindowOf(sender)
    if (!window || window.isDestroyed()) {
      throw new Error('Browser previews require a live owner window.')
    }
    const owner = this.options.createOwner(sender)
    this.owners.set(sender.id, owner)
    const dispose = () => this.disposeOwner(owner)
    const onNavigation = (details: RendererSurfaceNavigationStart) => {
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

  requireOwner(sender: Surface) {
    const owner = this.owners.get(sender.id)
    if (!owner || owner.sender !== sender) throw new Error('Browser preview owner was not found.')
    if (this.retiringOwners.has(owner)) throw new Error('Browser preview owner cleanup is pending.')
    return owner
  }

  requirePreview(sender: Surface, previewId: string) {
    const record = this.requireOwner(sender).previews.get(previewId)
    if (!record || record.disposed) throw new Error(`Browser preview "${previewId}" was not found.`)
    return record
  }

  findForRenderer(sender: Surface, previewId: string) {
    const owner = this.owners.get(sender.id)
    const record = owner?.sender === sender ? owner.previews.get(previewId) : undefined
    return record && this.isLive(record) ? record : undefined
  }

  findForDisposal(sender: Surface, previewId: string) {
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

  add(record: Preview) {
    const existing = this.recordsByOwnerKey.get(record.ownerKey)?.get(record.previewId)
    if (existing !== undefined) {
      throw new Error(`Browser preview "${record.previewId}" is already owned by this session.`)
    }
    record.owner.previews.set(record.previewId, record)
    const previews = this.recordsByOwnerKey.get(record.ownerKey) ?? new Map<string, Preview>()
    previews.set(record.previewId, record)
    this.recordsByOwnerKey.set(record.ownerKey, previews)
    this.markCurrent(record)
  }

  setCurrent(sender: Surface, ownerKey: string, previewId: string | null) {
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

  markCurrent(record: Preview) {
    if (!this.isLive(record)) throw new Error('Browser preview is no longer available.')
    const pending = this.pendingByOwnerKey.get(record.ownerKey)
    if (pending !== undefined) {
      if (pending.sender !== record.owner.sender || pending.previewId !== record.previewId) return
      this.pendingByOwnerKey.delete(record.ownerKey)
    }
    this.currentByOwnerKey.set(record.ownerKey, record)
  }

  forgetSelection(sender: Surface, ownerKey: string) {
    if (this.pendingByOwnerKey.get(ownerKey)?.sender === sender) {
      this.pendingByOwnerKey.delete(ownerKey)
    }
    if (this.currentByOwnerKey.get(ownerKey)?.owner.sender === sender) {
      this.currentByOwnerKey.delete(ownerKey)
    }
  }

  remove(record: Preview) {
    if (record.owner.previews.get(record.previewId) === record) {
      record.owner.previews.delete(record.previewId)
    }
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
      let fallback: Preview | undefined
      for (const candidate of previews.values()) fallback = candidate
      if (fallback) this.currentByOwnerKey.set(record.ownerKey, fallback)
    }
  }

  isLive(record: Preview) {
    return (
      !record.disposed &&
      !this.retiringOwners.has(record.owner) &&
      record.owner.previews.get(record.previewId) === record
    )
  }

  disposeOwner(owner: Owner) {
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
