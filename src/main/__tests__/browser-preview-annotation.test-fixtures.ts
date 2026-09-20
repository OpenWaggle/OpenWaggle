import type { BrowserPreviewElementPickPayload } from '@shared/types/browser-preview-controls'

export function annotationPayload(
  comment = 'Make this panel narrower.',
): BrowserPreviewElementPickPayload {
  return {
    version: 2,
    pageUrl: 'http://localhost:3000/settings',
    pageTitle: 'Settings',
    comment,
    elements: [],
    regions: [{ id: 'region-1', rect: { x: 1, y: 2, width: 3, height: 4 } }],
    strokes: [],
    styleChanges: [],
    captureRect: { x: 0, y: 0, width: 80, height: 30 },
  }
}
