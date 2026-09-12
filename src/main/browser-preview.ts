import { normalizeBrowserPreviewUrl } from '@shared/schemas/browser-preview'
import type {
  BrowserPreviewBounds,
  BrowserPreviewOpenInput,
  BrowserPreviewReplacementResult,
  BrowserPreviewShortcutBindings,
  BrowserPreviewState,
  BrowserPreviewZoomAction,
} from '@shared/types/browser-preview'
import type {
  BrowserPreviewAnnotation,
  BrowserPreviewAppearance,
  BrowserPreviewRecordingArtifact,
  BrowserPreviewRecordingGrant,
  BrowserPreviewRecordingSaveInput,
  BrowserPreviewScreenshotArtifact,
  BrowserPreviewViewport,
} from '@shared/types/browser-preview-controls'
import type { WebContents } from 'electron'
import { assertBrowserPreviewCapacity } from './browser-preview-capacity'
import { BrowserPreviewControlCoordinator } from './browser-preview-control-coordinator'
import { BrowserPreviewLifecycle } from './browser-preview-lifecycle'
import { BrowserPreviewNavigation } from './browser-preview-navigation'
import { emitBrowserPreviewState } from './browser-preview-owner-events'
import { browserPreviewOwnerRegistry } from './browser-preview-owner-registry'
import { createBrowserPreviewRecord } from './browser-preview-record-factory'
import { BrowserPreviewRecordRegistry } from './browser-preview-record-registry'
import type { BrowserPreviewRecord } from './browser-preview-records'
import { browserPreviewRestorationInput } from './browser-preview-replacement'
import { nextBrowserPreviewZoomFactor } from './browser-preview-zoom'

export { browserPreviewShortcutForInput } from './browser-preview-policy'

export class BrowserPreviewManager {
  private readonly records = new BrowserPreviewRecordRegistry({
    disposeRecord: (record) => this.lifecycle.retire(record),
  })
  private readonly controlCoordinator = new BrowserPreviewControlCoordinator({
    isLive: (record) => this.records.isLive(record),
    update: (record, controls) => {
      record.state = { ...record.state, controls }
      emitBrowserPreviewState(record)
      return record.state
    },
  })
  private readonly lifecycle = new BrowserPreviewLifecycle({
    disposeControls: (record) => this.controlCoordinator.dispose(record),
    removeRecord: (record) => this.records.remove(record),
  })
  private readonly navigation = new BrowserPreviewNavigation({
    detachDestroyed: (record) => this.lifecycle.detachDestroyed(record),
    dispose: (record) => this.lifecycle.dispose(record),
    emitState: (record) => emitBrowserPreviewState(record),
  })

  /** Resolve a session-owned preview without coupling automation to a renderer WebContents id. */
  findOwnedPreview(ownerKey: string, previewId?: string): BrowserPreviewRecord | undefined {
    return this.records.findOwned(ownerKey, previewId)
  }

  listOwnedPreviews(ownerKey: string): readonly BrowserPreviewRecord[] {
    return this.records.listOwned(ownerKey)
  }

  setCurrentPreview(sender: WebContents, ownerKey: string, previewId: string | null): void {
    browserPreviewOwnerRegistry.assertRegistered(ownerKey, sender)
    this.records.setCurrent(sender, ownerKey, previewId)
  }

  forgetOwnerSelection(sender: WebContents, ownerKey: string): void {
    this.records.forgetSelection(sender, ownerKey)
  }

  open(sender: WebContents, input: BrowserPreviewOpenInput): BrowserPreviewState {
    browserPreviewOwnerRegistry.assertRegistered(input.ownerKey, sender)
    const canonicalUrl = normalizeBrowserPreviewUrl(input.url)
    const owner = this.records.getOrCreateOwner(sender)
    const existing = owner.previews.get(input.previewId)
    if (existing) {
      if (existing.ownerKey !== input.ownerKey || existing.profileId !== input.profileId) {
        throw new Error('Browser preview owner and profile cannot change after creation.')
      }
      this.applyBounds(existing, input.bounds, input.visible)
      const state =
        existing.state.url !== canonicalUrl
          ? this.navigation.navigate(existing, canonicalUrl)
          : this.navigation.snapshot(existing)
      this.records.markCurrent(existing)
      browserPreviewOwnerRegistry.notifyMaterialized(input.ownerKey, input.previewId, sender)
      return state
    }

    assertBrowserPreviewCapacity(
      this.records.countOwned(input.ownerKey),
      this.records.countForRenderer(sender),
    )

    const record = createBrowserPreviewRecord({
      input,
      canonicalUrl,
      owner,
      onOwnerEventFailure: () => this.records.disposeOwner(owner),
    })
    try {
      this.records.add(record)
      owner.window.contentView.addChildView(record.view)
      record.view.setBounds(input.bounds)
      record.view.setVisible(input.visible)
      this.navigation.monitor(record)
      this.controlCoordinator.register(record)
      this.controlCoordinator.applyViewport(record)
      emitBrowserPreviewState(record)
      this.navigation.loadUrl(record, canonicalUrl)
      browserPreviewOwnerRegistry.notifyMaterialized(input.ownerKey, input.previewId, sender)
      return record.state
    } catch (error) {
      this.lifecycle.dispose(record)
      throw error
    }
  }

  setBounds(sender: WebContents, previewId: string, bounds: BrowserPreviewBounds | null): void {
    const record =
      bounds === null
        ? this.records.findForRenderer(sender, previewId)
        : this.requirePreview(sender, previewId)
    if (record === undefined) return
    if (bounds === null) {
      record.bounds = null
      record.view.setVisible(false)
      return
    }
    this.applyBounds(record, bounds, true)
  }

  navigate(sender: WebContents, previewId: string, url: string): BrowserPreviewState {
    return this.navigation.navigate(
      this.requirePreview(sender, previewId),
      normalizeBrowserPreviewUrl(url),
    )
  }

  beginAutomationNavigation(sender: WebContents, previewId: string, url: string) {
    return this.navigation.beginAutomationNavigation(
      this.requirePreview(sender, previewId),
      normalizeBrowserPreviewUrl(url),
    )
  }

  goBack(sender: WebContents, previewId: string): BrowserPreviewState {
    return this.navigation.goBack(this.requirePreview(sender, previewId))
  }

  goForward(sender: WebContents, previewId: string): BrowserPreviewState {
    return this.navigation.goForward(this.requirePreview(sender, previewId))
  }

  reload(sender: WebContents, previewId: string): BrowserPreviewState {
    return this.navigation.reload(this.requirePreview(sender, previewId))
  }

  stop(sender: WebContents, previewId: string): BrowserPreviewState {
    return this.navigation.stop(this.requirePreview(sender, previewId))
  }

  close(sender: WebContents, previewId: string): Promise<void> {
    return this.lifecycle.close(this.records.findForDisposal(sender, previewId))
  }

  replaceForCapacity(
    sender: WebContents,
    input: BrowserPreviewOpenInput,
    replacedPreviewId: string,
  ): BrowserPreviewReplacementResult {
    browserPreviewOwnerRegistry.assertRegistered(input.ownerKey, sender)
    if (input.previewId === replacedPreviewId) {
      throw new Error('A browser preview cannot replace itself for capacity.')
    }
    const replaced = this.records.findOwned(input.ownerKey, replacedPreviewId)
    if (!replaced) return { state: this.open(sender, input), replacedState: null }
    if (!this.records.isLive(replaced) || replaced.owner.sender !== sender) {
      throw new Error('Browser preview replacement is not owned by this renderer.')
    }
    const replacedState = replaced.state
    this.lifecycle.dispose(replaced)
    try {
      return { state: this.open(sender, input), replacedState }
    } catch (replacementError) {
      const partial = this.records.findOwned(input.ownerKey, input.previewId)
      if (partial && partial.owner.sender === sender) this.lifecycle.dispose(partial)
      try {
        this.open(sender, browserPreviewRestorationInput(replacedState))
      } catch (restoreError) {
        throw new AggregateError(
          [replacementError, restoreError],
          'Browser preview replacement and rollback both failed.',
          { cause: restoreError },
        )
      }
      throw replacementError
    }
  }

  zoom(sender: WebContents, previewId: string, action: BrowserPreviewZoomAction): number {
    const record = this.requirePreview(sender, previewId)
    const contents = record.view.webContents
    const next = nextBrowserPreviewZoomFactor(contents.getZoomFactor(), action)
    contents.setZoomFactor(next)
    this.controlCoordinator.setZoomFactor(record, next)
    return next
  }

  setViewport(
    sender: WebContents,
    previewId: string,
    viewport: BrowserPreviewViewport,
  ): BrowserPreviewState {
    return this.controlCoordinator.setViewport(this.requirePreview(sender, previewId), viewport)
  }

  hardReload(sender: WebContents, previewId: string): BrowserPreviewState {
    const record = this.requirePreview(sender, previewId)
    record.loadGeneration += 1
    record.state = { ...record.state, loading: true, error: null }
    this.controlCoordinator.hardReload(record)
    emitBrowserPreviewState(record)
    return record.state
  }

  setAppearance(
    sender: WebContents,
    previewId: string,
    appearance: BrowserPreviewAppearance,
  ): Promise<BrowserPreviewState> {
    return this.controlCoordinator.setAppearance(this.requirePreview(sender, previewId), appearance)
  }

  setAudioMuted(sender: WebContents, previewId: string, audioMuted: boolean): BrowserPreviewState {
    const record = this.requirePreview(sender, previewId)
    record.view.webContents.setAudioMuted(audioMuted)
    if (record.state.audioMuted === audioMuted) return record.state
    record.state = { ...record.state, audioMuted }
    emitBrowserPreviewState(record)
    return record.state
  }

  openDevTools(sender: WebContents, previewId: string): Promise<void> {
    return this.controlCoordinator.openDevTools(this.requirePreview(sender, previewId))
  }

  clearCookies(sender: WebContents, previewId: string): Promise<void> {
    return this.controlCoordinator.clearCookies(this.requirePreview(sender, previewId))
  }

  clearCache(sender: WebContents, previewId: string): Promise<void> {
    return this.controlCoordinator.clearCache(this.requirePreview(sender, previewId))
  }

  captureScreenshot(
    sender: WebContents,
    previewId: string,
  ): Promise<BrowserPreviewScreenshotArtifact> {
    return this.controlCoordinator.captureScreenshot(this.requirePreview(sender, previewId))
  }

  revealArtifact(sender: WebContents, artifactPath: string): Promise<void> {
    this.requireOwner(sender)
    return this.controlCoordinator.revealArtifact(artifactPath)
  }

  copyScreenshot(sender: WebContents, artifactPath: string): Promise<void> {
    this.requireOwner(sender)
    return this.controlCoordinator.copyScreenshot(artifactPath)
  }

  async startRecording(
    sender: WebContents,
    previewId: string,
  ): Promise<BrowserPreviewRecordingGrant> {
    return this.controlCoordinator.startRecording(this.requirePreview(sender, previewId))
  }

  saveRecording(
    sender: WebContents,
    input: BrowserPreviewRecordingSaveInput,
  ): Promise<BrowserPreviewRecordingArtifact> {
    return this.controlCoordinator.saveRecording(
      this.requirePreview(sender, input.previewId),
      input,
    )
  }

  stopRecording(sender: WebContents, previewId: string): void {
    this.controlCoordinator.stopRecording(this.requirePreview(sender, previewId))
  }

  pickElement(sender: WebContents, previewId: string): Promise<BrowserPreviewAnnotation | null> {
    return this.controlCoordinator.pickElement(this.requirePreview(sender, previewId))
  }

  cancelPickElement(sender: WebContents, previewId: string): Promise<void> {
    return this.controlCoordinator.cancelPickElement(this.requirePreview(sender, previewId))
  }

  openPictureInPicture(sender: WebContents, previewId: string): Promise<BrowserPreviewState> {
    return this.controlCoordinator.openPictureInPicture(this.requirePreview(sender, previewId))
  }

  closePictureInPicture(sender: WebContents, previewId: string): BrowserPreviewState {
    return this.controlCoordinator.closePictureInPicture(this.requirePreview(sender, previewId))
  }

  setShortcutBindings(sender: WebContents, bindings: BrowserPreviewShortcutBindings): void {
    const owner = this.records.getOrCreateOwner(sender)
    owner.shortcutBindings = bindings.map((binding) => ({ ...binding }))
  }

  private requirePreview(sender: WebContents, previewId: string) {
    return this.records.requirePreview(sender, previewId)
  }

  private requireOwner(sender: WebContents) {
    return this.records.requireOwner(sender)
  }

  private applyBounds(
    record: BrowserPreviewRecord,
    bounds: BrowserPreviewBounds,
    visible: boolean,
  ) {
    record.bounds = visible ? bounds : null
    record.view.setBounds(bounds)
    record.view.setVisible(visible)
    if (visible && !record.owner.window.isDestroyed()) {
      record.owner.window.contentView.addChildView(record.view)
    }
    this.controlCoordinator.applyViewport(record)
  }
}

export const browserPreviewManager = new BrowserPreviewManager()
