import path from 'node:path'
import type { InlineVisualizationDownloadInput } from '@shared/types/inline-visualization'

const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024
const MAX_DOWNLOAD_BASE64_LENGTH = Math.ceil(MAX_DOWNLOAD_BYTES / 3) * 4
const MIN_PRINTABLE_CODE_POINT = 32
const DELETE_CODE_POINT = 127
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
  const basename = [...path.win32.basename(path.posix.basename(input.suggestedName))]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint >= MIN_PRINTABLE_CODE_POINT && codePoint !== DELETE_CODE_POINT
    })
    .join('')
    .slice(0, MAX_SUGGESTED_FILENAME_LENGTH)
  return { contents, suggestedName: basename || 'visualization-download' }
}
