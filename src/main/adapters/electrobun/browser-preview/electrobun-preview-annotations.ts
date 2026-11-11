import type { BrowserPreviewAnnotation } from '@shared/types/browser-preview-controls'
import type { ElectrobunPreviewControls } from './electrobun-preview-controls'
import type { ElectrobunPreviewHost } from './electrobun-preview-record-factory'
import type { ElectrobunPreviewRecord } from './electrobun-preview-records'
import { prepareBrowserPreviewAnnotation } from '../../browser-preview/annotation/browser-preview-annotation'
import {
  BrowserPreviewElementPicker,
  type BrowserPreviewPickerPage,
} from '../../browser-preview/annotation/browser-preview-element-picker'

function pickKey(record: ElectrobunPreviewRecord) {
  return `${record.state.ownerKey}:${record.previewId}`
}

/**
 * The element picker and annotation editor on a CEF preview. The picker runs in the page
 * script's isolated world, which the page cannot reach, and reports through its CDP binding; what
 * it reports is page-derived, so the shared picker decodes it before anything reads it.
 */
export class ElectrobunPreviewAnnotations {
  private readonly picker: BrowserPreviewElementPicker
  private readonly controls: ElectrobunPreviewControls

  constructor(host: ElectrobunPreviewHost, controls: ElectrobunPreviewControls) {
    this.controls = controls
    this.picker = new BrowserPreviewElementPicker((payload, screenshot) =>
      prepareBrowserPreviewAnnotation(
        host.artifacts(),
        payload,
        screenshot,
        host.prepareAnnotation,
      ),
    )
  }

  async pick(record: ElectrobunPreviewRecord): Promise<BrowserPreviewAnnotation | null> {
    this.controls.updateControls(record, { picking: true })
    try {
      // CDP screenshots take CSS pixels, the units the picker reports, at any zoom or viewport.
      const annotation = await this.picker.pick(
        pickKey(record),
        record.previewId,
        this.page(record),
      )
      return record.disposed ? null : annotation
    } finally {
      if (!record.disposed) this.controls.updateControls(record, { picking: false })
    }
  }

  async cancel(record: ElectrobunPreviewRecord): Promise<void> {
    await this.picker.cancel(pickKey(record))
    if (!record.disposed) this.controls.updateControls(record, { picking: false })
  }

  private page(record: ElectrobunPreviewRecord): BrowserPreviewPickerPage {
    return {
      assertAvailable: () => {
        if (record.disposed) throw new Error('Browser preview content was retired.')
      },
      isDestroyed: () => record.disposed,
      runPicker: (script) => record.guest.runPicker(script),
      runControl: (script) => record.guest.runPickerControl(script),
      captureScreenshot: (clip) => this.controls.captureScreenshot(record, clip),
    }
  }
}
