import { randomUUID } from 'node:crypto'
import type {
  BrowserPreviewOpenRequest,
  BrowserPreviewOpenRequestAck,
  BrowserPreviewOpenRequestCancellation,
  BrowserPreviewOpenRequestInput,
} from '@shared/types/browser-preview-owner'
import type {
  RendererSurface,
  RendererSurfaceNavigationStart,
} from '../../ports/desktop-shell/renderer-surfaces'
import { isTrustedRendererDocument } from '../../renderer-document-trust'

const DEFAULT_MATERIALIZATION_TIMEOUT_MS = 15_000
const MAX_MATERIALIZATION_TIMEOUT_MS = 60_000
const MAX_REGISTERED_OWNERS = 64
const MAX_PENDING_OPENS = 64

/**
 * The window behind an owner page, for a shell whose window can close before its page reports
 * `destroyed` (Electron). `null` when the page has no live window.
 */
export interface BrowserPreviewOwnerWindow {
  isDestroyed(): boolean
  once(event: 'closed', listener: () => void): unknown
  removeListener(event: 'closed', listener: () => void): unknown
}

interface RegisteredOwner<Surface extends RendererSurface> {
  readonly sender: Surface
  readonly removeListeners: readonly (() => void)[]
}

interface PendingOpen<Surface extends RendererSurface> {
  readonly request: BrowserPreviewOpenRequest
  readonly sender: Surface
  readonly resolve: () => void
  readonly reject: (error: Error) => void
  readonly timeout: ReturnType<typeof setTimeout>
  readonly removeAbort: () => void
  acknowledged: boolean
  materialized: boolean
}

export interface BrowserPreviewOpenWaitOptions {
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

function previewKey(ownerKey: string, previewId: string) {
  return `${ownerKey}\0${previewId}`
}

function materializationTimeout(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_MATERIALIZATION_TIMEOUT_MS
  }
  return Math.max(1, Math.min(Math.floor(value), MAX_MATERIALIZATION_TIMEOUT_MS))
}

function errorFromUnknown(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause : new Error(fallback)
}

function attemptOwnerCleanup(action: () => void) {
  try {
    action()
  } catch {
    // Continue releasing pending requests after a shell listener race.
  }
}

/**
 * Binds durable workspace-session keys to trusted renderer processes and coordinates
 * main-to-renderer preview materialization. An open succeeds only after both sides
 * confirm it: the manager owns the native view and the renderer owns the matching tab.
 */
export class BrowserPreviewOwnerRegistry<Surface extends RendererSurface = RendererSurface> {
  private readonly owners = new Map<string, RegisteredOwner<Surface>>()
  private readonly pendingByRequestId = new Map<string, PendingOpen<Surface>>()
  private readonly pendingRequestByPreview = new Map<string, string>()
  private nextGeneration = 0

  private readonly ownerWindowOf: (owner: Surface) => BrowserPreviewOwnerWindow | null

  constructor(ownerWindowOf: (owner: Surface) => BrowserPreviewOwnerWindow | null) {
    this.ownerWindowOf = ownerWindowOf
  }

  register(ownerKey: string, sender: Surface) {
    const existing = this.owners.get(ownerKey)
    if (existing?.sender === sender) return
    if (existing) throw new Error('This browser-preview owner is already registered.')
    if (this.owners.size >= MAX_REGISTERED_OWNERS) {
      throw new Error('Too many browser-preview owners are registered.')
    }
    if (sender.isDestroyed()) throw new Error('Browser-preview owner has been destroyed.')
    const window = this.ownerWindowOf(sender)
    if (!window || window.isDestroyed()) {
      throw new Error('Browser-preview owner requires a live window.')
    }

    const unregister = () => this.unregister(ownerKey, sender)
    const onNavigation = (details: RendererSurfaceNavigationStart) => {
      if (
        details.isMainFrame &&
        !details.isSameDocument &&
        !isTrustedRendererDocument(details.url)
      ) {
        unregister()
      }
    }
    sender.once('destroyed', unregister)
    sender.once('render-process-gone', unregister)
    sender.on('did-start-navigation', onNavigation)
    window.once('closed', unregister)
    this.owners.set(ownerKey, {
      sender,
      removeListeners: [
        () => sender.removeListener('destroyed', unregister),
        () => sender.removeListener('render-process-gone', unregister),
        () => sender.removeListener('did-start-navigation', onNavigation),
        () => window.removeListener('closed', unregister),
      ],
    })
  }

  unregister(ownerKey: string, sender: Surface) {
    const owner = this.owners.get(ownerKey)
    if (!owner || owner.sender !== sender) return
    this.owners.delete(ownerKey)
    for (const removeListener of owner.removeListeners) attemptOwnerCleanup(removeListener)
    for (const operation of [...this.pendingByRequestId.values()]) {
      if (operation.request.ownerKey !== ownerKey || operation.sender !== sender) continue
      this.reject(
        operation,
        new Error('Browser-preview owner was unregistered.'),
        !sender.isDestroyed(),
      )
    }
  }

  /** A live renderer holds this owner: the Session is open, or retains previews or a Run. */
  isRegistered(ownerKey: string) {
    const owner = this.owners.get(ownerKey)
    return owner !== undefined && !owner.sender.isDestroyed()
  }

  assertRegistered(ownerKey: string, sender: Surface) {
    const owner = this.owners.get(ownerKey)
    if (!owner || owner.sender !== sender || sender.isDestroyed()) {
      throw new Error('Browser-preview owner is not registered to this renderer.')
    }
  }

  requestOpen(input: BrowserPreviewOpenRequestInput, options: BrowserPreviewOpenWaitOptions = {}) {
    const owner = this.owners.get(input.ownerKey)
    if (!owner || owner.sender.isDestroyed()) {
      return Promise.reject(
        new Error('No renderer is registered for this browser-preview owner.'),
      ) satisfies Promise<void>
    }
    if (options.signal?.aborted) {
      return Promise.reject(new Error('Browser-preview open was aborted.')) satisfies Promise<void>
    }
    const key = previewKey(input.ownerKey, input.previewId)
    if (this.pendingRequestByPreview.has(key)) {
      return Promise.reject(
        new Error('This browser preview is already being opened.'),
      ) satisfies Promise<void>
    }
    if (this.pendingByRequestId.size >= MAX_PENDING_OPENS) {
      return Promise.reject(
        new Error('Too many browser previews are waiting to open.'),
      ) satisfies Promise<void>
    }

    const request: BrowserPreviewOpenRequest = {
      ...input,
      requestId: randomUUID(),
      generation: this.nextRequestGeneration(),
    }
    return new Promise((resolve, reject) => {
      const abort = () => {
        const operation = this.pendingByRequestId.get(request.requestId)
        if (operation) {
          this.reject(operation, new Error('Browser-preview open was aborted.'), true)
        }
      }
      const timeout = setTimeout(() => {
        const operation = this.pendingByRequestId.get(request.requestId)
        if (operation) {
          this.reject(
            operation,
            new Error('Browser preview did not materialize before the timeout.'),
            true,
          )
        }
      }, materializationTimeout(options.timeoutMs))
      const operation: PendingOpen<Surface> = {
        request,
        sender: owner.sender,
        resolve,
        reject,
        timeout,
        removeAbort: () => options.signal?.removeEventListener('abort', abort),
        acknowledged: false,
        materialized: false,
      }
      this.pendingByRequestId.set(request.requestId, operation)
      this.pendingRequestByPreview.set(key, request.requestId)
      options.signal?.addEventListener('abort', abort, { once: true })
      try {
        owner.sender.send('browser-preview:open-request', request)
      } catch (cause) {
        this.reject(
          operation,
          errorFromUnknown(cause, 'Browser-preview open request could not be sent.'),
          false,
        )
      }
    }) satisfies Promise<void>
  }

  acknowledge(sender: Surface, acknowledgment: BrowserPreviewOpenRequestAck) {
    const operation = this.pendingByRequestId.get(acknowledgment.requestId)
    if (!operation) {
      throw new Error('Browser-preview open request is no longer active.')
    }
    if (
      operation.sender !== sender ||
      operation.request.ownerKey !== acknowledgment.ownerKey ||
      operation.request.previewId !== acknowledgment.previewId ||
      operation.request.generation !== acknowledgment.generation
    ) {
      throw new Error('Browser-preview open acknowledgment does not match its trusted request.')
    }
    if (!acknowledgment.success) {
      this.reject(
        operation,
        new Error(acknowledgment.error || 'Renderer could not materialize the browser preview.'),
        true,
      )
      return
    }
    operation.acknowledged = true
    this.resolveIfComplete(operation)
  }

  notifyMaterialized(ownerKey: string, previewId: string, sender: Surface) {
    const requestId = this.pendingRequestByPreview.get(previewKey(ownerKey, previewId))
    if (!requestId) return
    const operation = this.pendingByRequestId.get(requestId)
    if (!operation || operation.sender !== sender) return
    operation.materialized = true
    this.resolveIfComplete(operation)
  }

  private nextRequestGeneration() {
    this.nextGeneration =
      this.nextGeneration >= Number.MAX_SAFE_INTEGER ? 1 : this.nextGeneration + 1
    return this.nextGeneration
  }

  private resolveIfComplete(operation: PendingOpen<Surface>) {
    if (!operation.acknowledged || !operation.materialized) return
    this.remove(operation)
    operation.resolve()
  }

  private reject(operation: PendingOpen<Surface>, error: Error, notifyRenderer: boolean) {
    if (this.pendingByRequestId.get(operation.request.requestId) !== operation) return
    this.remove(operation)
    if (notifyRenderer) this.sendCancellation(operation)
    operation.reject(error)
  }

  private remove(operation: PendingOpen<Surface>) {
    this.pendingByRequestId.delete(operation.request.requestId)
    const key = previewKey(operation.request.ownerKey, operation.request.previewId)
    if (this.pendingRequestByPreview.get(key) === operation.request.requestId) {
      this.pendingRequestByPreview.delete(key)
    }
    clearTimeout(operation.timeout)
    operation.removeAbort()
  }

  private sendCancellation(operation: PendingOpen<Surface>) {
    if (operation.sender.isDestroyed()) return
    const cancellation: BrowserPreviewOpenRequestCancellation = {
      requestId: operation.request.requestId,
      generation: operation.request.generation,
      ownerKey: operation.request.ownerKey,
      previewId: operation.request.previewId,
    }
    try {
      operation.sender.send('browser-preview:cancel-open-request', cancellation)
    } catch {
      // Renderer teardown also tears down every native view through the owner lifecycle.
    }
  }
}
