import path from 'node:path'
import type { InlineVisualizationDownloadInput } from '@shared/types/inline-visualization'

const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024
const MAX_DOWNLOAD_BASE64_LENGTH = Math.ceil(MAX_DOWNLOAD_BYTES / 3) * 4
/** C0 and C1 control characters, including DEL. */
const CONTROL_CHARACTERS = /\p{Cc}/gu
const MAX_SUGGESTED_FILENAME_LENGTH = 180

export function decodeInlineVisualizationDownload(input: InlineVisualizationDownloadInput) {
  if (
    input.base64Data.length > MAX_DOWNLOAD_BASE64_LENGTH ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64Data)
  ) {
    throw new Error('Invalid visualization download payload')
  }
  const contents = Buffer.from(input.base64Data, 'base64')
  if (contents.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error('Visualization download exceeds the safety limit')
  }
  const basename = path.win32
    .basename(path.posix.basename(input.suggestedName))
    .replace(CONTROL_CHARACTERS, '')
    .slice(0, MAX_SUGGESTED_FILENAME_LENGTH)
  return { contents, suggestedName: basename || 'visualization-download' }
}
