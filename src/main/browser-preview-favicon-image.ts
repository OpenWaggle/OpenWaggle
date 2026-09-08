import { MAX_FAVICON_SOURCE_PIXELS } from './browser-preview-favicon-format-constants'

export interface BrowserPreviewImageDimensions {
  readonly width: number
  readonly height: number
}

export function safeBrowserPreviewImageDimensions(
  dimensions: BrowserPreviewImageDimensions | null,
): dimensions is BrowserPreviewImageDimensions {
  return (
    dimensions !== null &&
    Number.isSafeInteger(dimensions.width) &&
    Number.isSafeInteger(dimensions.height) &&
    dimensions.width > 0 &&
    dimensions.height > 0 &&
    dimensions.width * dimensions.height <= MAX_FAVICON_SOURCE_PIXELS
  )
}
