import { isBrowserPreviewUrl, normalizeBrowserPreviewUrl } from '@shared/schemas/browser-preview'
import type { BrowserPreviewError } from '@shared/types/browser-preview'

const MAX_ERROR_DESCRIPTION_LENGTH = 1_024

export const MAX_TITLE_LENGTH = 512
/** Chromium's `net::ERR_ABORTED`: a load replaced by another one, not a failure to show. */
export const ABORTED_LOAD_ERROR_CODE = -3
/** The same as CDP reports it, in `Page.navigate`'s `errorText`. */
export const ABORTED_LOAD_ERROR_TEXT = 'net::ERR_ABORTED'

export function boundedBrowserPreviewText(value: string, maxLength: number) {
  return value.length <= maxLength ? value : value.slice(0, maxLength)
}

export function browserPreviewStateError(
  code: string,
  description: string,
  url: string,
): BrowserPreviewError {
  return {
    code,
    description: boundedBrowserPreviewText(description, MAX_ERROR_DESCRIPTION_LENGTH),
    url: isBrowserPreviewUrl(url) ? normalizeBrowserPreviewUrl(url) : '',
  }
}
