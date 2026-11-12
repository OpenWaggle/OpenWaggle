import type { BrowserPreviewBounds } from '@shared/types/browser-preview'
import type { BrowserPreviewRecord } from './browser-preview-records'

export function applyBrowserPreviewBounds(
  record: BrowserPreviewRecord,
  bounds: BrowserPreviewBounds,
  visible: boolean,
  controls: { readonly applyViewport: (record: BrowserPreviewRecord) => void },
): void {
  record.bounds = visible ? bounds : null
  record.view.setBounds(bounds)
  record.view.setVisible(visible)
  if (visible && !record.owner.window.isDestroyed()) {
    record.owner.window.contentView.addChildView(record.view)
  }
  controls.applyViewport(record)
}
