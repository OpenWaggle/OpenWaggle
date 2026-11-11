import { match } from '@diegogbrisa/ts-match'
import { normalizeBrowserPreviewUrl } from '@shared/schemas/browser-preview'
import type {
  BrowserPreviewBounds,
  BrowserPreviewOpenInput,
  BrowserPreviewReplacementResult,
  BrowserPreviewShortcutBindings,
  BrowserPreviewState,
} from '@shared/types/browser-preview'
import type { DesktopMutationScope } from '@shared/types/desktop-service'
import { ElectrobunPreviewControls } from './electrobun-preview-controls'
import type { ElectrobunPreviewGuestEvent } from './electrobun-preview-cdp-protocol'
import {
  applyElectrobunPreviewGuestEvent,
  createElectrobunPreviewRecord,
  type ElectrobunPreviewHost,
} from './electrobun-preview-record-factory'
import type { ElectrobunPreviewOwner, ElectrobunPreviewRecord } from './electrobun-preview-records'
import { assertBrowserPreviewCapacity } from '../../browser-preview/browser-preview-capacity'
import { decideBrowserPreviewKeyInput } from '../../browser-preview/browser-preview-key-input'
import { BrowserPreviewMutationFences } from '../../browser-preview/browser-preview-mutation-fences'
import { sendBrowserPreviewOwnerEvent } from '../../browser-preview/browser-preview-owner-events'
import { BrowserPreviewOwnerRegistry } from '../../browser-preview/browser-preview-owner-registry'
import { BrowserPreviewRecordRegistry } from '../../browser-preview/browser-preview-record-registry'
import { BrowserPreviewReplacement } from '../../browser-preview/browser-preview-replacement'
import { BrowserPreviewShutdown } from '../../browser-preview/browser-preview-shutdown'
import { assertDesktopNativeAdmission } from '../../../desktop-native-admission'
import type { RendererSurface } from '../../../ports/desktop-shell/renderer-surfaces'

/**
 * The Session-owned Browser preview on Electrobun: CEF `BrowserView`s in the owner page's window,
 * driven over CDP. Owner leases, selection, capacity, fences, shutdown and replacement are the
 * shell-neutral modules Electron uses too.
 */
export class ElectrobunBrowserPreviewManager {
  readonly ownerRegistry: BrowserPreviewOwnerRegistry
  private readonly mutationFences = new BrowserPreviewMutationFences()
  private readonly records: BrowserPreviewRecordRegistry<
    RendererSurface,
    ElectrobunPreviewOwner,
    ElectrobunPreviewRecord
  >
  private readonly shutdown = new BrowserPreviewShutdown<ElectrobunPreviewRecord>(
    async (record) => this.dispose(record),
    (record, listener) => record.destroyedListeners.push(listener),
  )
  private readonly replacement: BrowserPreviewReplacement<RendererSurface, ElectrobunPreviewRecord>
  readonly controls: ElectrobunPreviewControls
  private readonly host: ElectrobunPreviewHost

  constructor(host: ElectrobunPreviewHost) {
    this.host = host
    this.ownerRegistry = new BrowserPreviewOwnerRegistry((owner) => host.ownerWindowOf(owner))
    this.records = new BrowserPreviewRecordRegistry({
      disposeRecord: (record) => this.dispose(record),
      ownerWindowOf: (sender) => host.ownerWindowOf(sender),
      createOwner: (sender) => {
        const window = host.ownerWindowOf(sender)
        if (window === null) throw new Error('Browser previews require a live owner window.')
        return {
          sender,
          windowId: window.id,
          previews: new Map(),
          shortcutBindings: [],
          removeListeners: [],
        }
      },
    })
    this.replacement = new BrowserPreviewReplacement({
      findOwned: (ownerKey, previewId) => this.records.findOwned(ownerKey, previewId),
      isLive: (record) => this.records.isLive(record),
      dispose: (record) => this.dispose(record),
      open: (sender, input) => this.open(sender, input),
    })
    this.controls = new ElectrobunPreviewControls(host)
  }

  findOwnedPreview(ownerKey: string, previewId?: string): ElectrobunPreviewRecord | undefined {
    return this.records.findOwned(ownerKey, previewId)
  }

  /** Navigates for the agent: the state shows the new URL loading, as a user's navigation does. */
  beginNavigation(record: ElectrobunPreviewRecord, url: string): string {
    const canonicalUrl = normalizeBrowserPreviewUrl(url)
    this.assertAdmission(record.ownerKey)
    this.controls.update(record, { url: canonicalUrl, title: '', loading: true, error: null })
    return canonicalUrl
  }

  listOwnedPreviews(ownerKey: string): readonly ElectrobunPreviewRecord[] {
    return this.records.listOwned(ownerKey)
  }

  setCurrentPreview(sender: RendererSurface, ownerKey: string, previewId: string | null): void {
    this.ownerRegistry.assertRegistered(ownerKey, sender)
    this.records.setCurrent(sender, ownerKey, previewId)
  }

  forgetOwnerSelection(sender: RendererSurface, ownerKey: string): void {
    this.records.forgetSelection(sender, ownerKey)
  }

  open(sender: RendererSurface, input: BrowserPreviewOpenInput): BrowserPreviewState {
    this.assertAdmission(input.ownerKey)
    this.ownerRegistry.assertRegistered(input.ownerKey, sender)
    const canonicalUrl = normalizeBrowserPreviewUrl(input.url)
    const owner = this.records.getOrCreateOwner(sender)
    const existing = owner.previews.get(input.previewId)
    if (existing) {
      if (existing.ownerKey !== input.ownerKey || existing.profileId !== input.profileId) {
        throw new Error('Browser preview owner and profile cannot change after creation.')
      }
      this.controls.place(existing, input.visible ? input.bounds : null)
      if (existing.state.url !== canonicalUrl) this.navigateRecord(existing, canonicalUrl)
      this.records.markCurrent(existing)
      this.ownerRegistry.notifyMaterialized(input.ownerKey, input.previewId, sender)
      return existing.state
    }
    assertBrowserPreviewCapacity(
      this.records.countOwned(input.ownerKey),
      this.records.countForRenderer(sender),
    )
    const record = createElectrobunPreviewRecord({
      host: this.host,
      owner,
      input,
      canonicalUrl,
      onOwnerEventFailure: () => this.records.disposeOwner(owner),
      onGuestEvent: (target, event) => this.onGuestEvent(target, event),
    })
    try {
      this.records.add(record)
      this.shutdown.track(record)
      this.controls.place(record, input.visible ? input.bounds : null)
      void record.guest
        .start(canonicalUrl, this.controls.pageConfig(record))
        .then(() => this.controls.applyEmulation(record))
        .catch((error: unknown) => this.controls.fail(record, error))
      this.ownerRegistry.notifyMaterialized(input.ownerKey, input.previewId, sender)
      return record.state
    } catch (error) {
      this.dispose(record)
      throw error
    }
  }

  replaceForCapacity(
    sender: RendererSurface,
    input: BrowserPreviewOpenInput,
    replacedPreviewId: string,
  ): BrowserPreviewReplacementResult {
    this.assertAdmission(input.ownerKey)
    this.ownerRegistry.assertRegistered(input.ownerKey, sender)
    return this.replacement.replace(sender, input, replacedPreviewId)
  }

  setBounds(sender: RendererSurface, previewId: string, bounds: BrowserPreviewBounds | null) {
    const record =
      bounds === null
        ? this.records.findForRenderer(sender, previewId)
        : this.requirePreview(sender, previewId)
    if (record !== undefined) this.controls.place(record, bounds)
  }

  navigate(sender: RendererSurface, previewId: string, url: string): BrowserPreviewState {
    const record = this.requirePreview(sender, previewId)
    return this.navigateRecord(record, normalizeBrowserPreviewUrl(url))
  }

  /** Runs a navigation-like command: the state shows loading until the page reports back. */
  command(
    sender: RendererSurface,
    previewId: string,
    run: (record: ElectrobunPreviewRecord) => Promise<void>,
    loading = true,
  ): BrowserPreviewState {
    const record = this.requirePreview(sender, previewId)
    if (loading) this.controls.update(record, { loading: true, error: null })
    void run(record).catch((error: unknown) => this.controls.fail(record, error))
    return record.state
  }

  close(sender: RendererSurface, previewId: string): Promise<void> {
    const record = this.records.findForDisposal(sender, previewId)
    if (record !== undefined) this.dispose(record)
    return Promise.resolve()
  }

  closeForOwner(ownerKey: string): Promise<void> {
    return this.shutdown.closeForOwner(ownerKey)
  }

  beginShutdown(): void {
    this.shutdown.beginShutdown()
  }

  closeAll(): Promise<void> {
    return this.shutdown.closeAll()
  }

  acquireMutationFence(scope: DesktopMutationScope): Promise<() => void> {
    return Promise.resolve(this.mutationFences.acquire(scope))
  }

  setShortcutBindings(sender: RendererSurface, bindings: BrowserPreviewShortcutBindings): void {
    const owner = this.records.getOrCreateOwner(sender)
    owner.shortcutBindings = bindings.map((binding) => ({ ...binding }))
    for (const record of owner.previews.values()) this.controls.configurePage(record)
  }

  requirePreview(sender: RendererSurface, previewId: string): ElectrobunPreviewRecord {
    const record = this.records.requirePreview(sender, previewId)
    this.assertAdmission(record.ownerKey)
    return record
  }

  requireOwner(sender: RendererSurface): ElectrobunPreviewOwner {
    return this.records.requireOwner(sender)
  }

  private navigateRecord(record: ElectrobunPreviewRecord, canonicalUrl: string) {
    if (record.state.url === canonicalUrl && !record.state.error) return record.state
    this.controls.update(record, { url: canonicalUrl, title: '', loading: true, error: null })
    void record.guest
      .navigate(canonicalUrl)
      .catch((error: unknown) => this.controls.fail(record, error))
    return record.state
  }

  private onGuestEvent(record: ElectrobunPreviewRecord, event: ElectrobunPreviewGuestEvent) {
    if (event.kind === 'key') {
      this.onKey(record, event.input)
      return
    }
    if (event.kind === 'navigated' || event.kind === 'crashed') {
      this.controls.applyEmulationSoon(record)
    }
    applyElectrobunPreviewGuestEvent(record, event)
  }

  private onKey(
    record: ElectrobunPreviewRecord,
    input: Extract<ElectrobunPreviewGuestEvent, { kind: 'key' }>['input'],
  ) {
    if (record.disposed) return
    const decision = decideBrowserPreviewKeyInput(
      {
        previewId: record.previewId,
        bindings: record.owner.shortcutBindings,
        claimedKeys: record.claimedShortcutKeys,
        isMac: this.host.isMac,
      },
      input,
    )
    if (decision.kind === 'claim' || decision.kind === 'release') {
      if (decision.event !== null) {
        sendBrowserPreviewOwnerEvent(record, {
          channel: 'browser-preview:key-event',
          payload: decision.event,
        })
      }
      return
    }
    if (decision.kind !== 'shortcut') return
    const { sender } = record.owner
    match(decision.shortcut)
      .with('reload', () => this.command(sender, record.previewId, (r) => r.guest.reload(false)))
      .with('back', () => this.command(sender, record.previewId, (r) => r.guest.goBack(), false))
      .with('forward', () =>
        this.command(sender, record.previewId, (r) => r.guest.goForward(), false),
      )
      .with('focus-location', 'close', (action) =>
        sendBrowserPreviewOwnerEvent(record, {
          channel: 'browser-preview:shortcut',
          payload: { previewId: record.previewId, action },
          focusOwner: true,
        }),
      )
      .exhaustive()
  }

  private dispose(record: ElectrobunPreviewRecord) {
    if (record.disposed) return
    record.disposed = true
    this.records.remove(record)
    try {
      record.guest.close()
    } finally {
      for (const listener of record.destroyedListeners.splice(0)) listener()
    }
  }

  private assertAdmission(ownerKey: string) {
    assertDesktopNativeAdmission()
    this.shutdown.assertCanOpen(ownerKey)
    this.mutationFences.assertAllowed(ownerKey)
  }
}
