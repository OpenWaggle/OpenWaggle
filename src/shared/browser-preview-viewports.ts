import type {
  BrowserPreviewFixedViewport,
  BrowserPreviewViewportPresetId,
} from './types/browser-preview-controls'

export const BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION = 240
export const BROWSER_PREVIEW_VIEWPORT_MAX_DIMENSION = 3_840
export const BROWSER_PREVIEW_VIEWPORT_MAX_AREA = 3_840 * 2_160

export interface BrowserPreviewViewportPreset {
  readonly id: BrowserPreviewViewportPresetId
  readonly label: string
  readonly width: number
  readonly height: number
}

const PRESET_DEFINITIONS = [
  ['iphone-se', 'iPhone SE', 375, 667],
  ['iphone-xr', 'iPhone XR', 414, 896],
  ['iphone-12-pro', 'iPhone 12 Pro', 390, 844],
  ['iphone-14-pro-max', 'iPhone 14 Pro Max', 430, 932],
  ['pixel-7', 'Pixel 7', 412, 915],
  ['samsung-galaxy-s8-plus', 'Samsung Galaxy S8+', 360, 740],
  ['samsung-galaxy-s20-ultra', 'Samsung Galaxy S20 Ultra', 412, 915],
  ['ipad-mini', 'iPad Mini', 768, 1_024],
  ['ipad-air', 'iPad Air', 820, 1_180],
  ['ipad-pro', 'iPad Pro', 1_024, 1_366],
  ['surface-pro-7', 'Surface Pro 7', 912, 1_368],
  ['surface-duo', 'Surface Duo', 540, 720],
  ['galaxy-z-fold-5', 'Galaxy Z Fold 5', 344, 882],
  ['asus-zenbook-fold', 'Asus Zenbook Fold', 853, 1_280],
  ['samsung-galaxy-a51-71', 'Samsung Galaxy A51/71', 412, 914],
  ['nest-hub', 'Nest Hub', 1_024, 600],
  ['nest-hub-max', 'Nest Hub Max', 1_280, 800],
] as const satisfies readonly (readonly [BrowserPreviewViewportPresetId, string, number, number])[]

export const BROWSER_PREVIEW_VIEWPORT_PRESETS: readonly BrowserPreviewViewportPreset[] =
  PRESET_DEFINITIONS.map(([id, label, width, height]) => ({ id, label, width, height }))

export function browserPreviewPresetViewport(
  presetId: BrowserPreviewViewportPresetId,
  orientation: 'portrait' | 'landscape' = 'portrait',
): BrowserPreviewFixedViewport {
  const preset = BROWSER_PREVIEW_VIEWPORT_PRESETS.find((candidate) => candidate.id === presetId)
  if (preset === undefined) throw new Error(`Unknown browser preview preset: ${presetId}`)
  const nativePortrait = preset.height >= preset.width
  const shouldRotate = orientation === 'landscape' ? nativePortrait : !nativePortrait
  return {
    mode: 'fixed',
    width: shouldRotate ? preset.height : preset.width,
    height: shouldRotate ? preset.width : preset.height,
    presetId,
  }
}

export function isValidBrowserPreviewViewportSize(width: number, height: number): boolean {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width >= BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION &&
    height >= BROWSER_PREVIEW_VIEWPORT_MIN_DIMENSION &&
    width <= BROWSER_PREVIEW_VIEWPORT_MAX_DIMENSION &&
    height <= BROWSER_PREVIEW_VIEWPORT_MAX_DIMENSION &&
    width * height <= BROWSER_PREVIEW_VIEWPORT_MAX_AREA
  )
}

export function rotateBrowserPreviewViewport(
  viewport: BrowserPreviewFixedViewport,
): BrowserPreviewFixedViewport {
  return { ...viewport, width: viewport.height, height: viewport.width }
}
