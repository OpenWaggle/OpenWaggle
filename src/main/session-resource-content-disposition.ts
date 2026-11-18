const MAX_CONTENT_DISPOSITION_FILENAME_BYTES = 180
const HEX_RADIX = 16

function truncateUtf8(value: string, maxBytes: number) {
  let result = ''
  let bytes = 0
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character)
    if (bytes + characterBytes > maxBytes) break
    result += character
    bytes += characterBytes
  }
  return result
}

function boundedDownloadFileName(fileName: string) {
  const wellFormed = fileName.replaceAll(/[\uD800-\uDFFF]/gu, '\uFFFD').trim()
  const bounded = truncateUtf8(wellFormed, MAX_CONTENT_DISPOSITION_FILENAME_BYTES)
  return bounded.length > 0 ? bounded : 'download'
}

function safeDownloadFileName(fileName: string) {
  // One `_` per code point that is not printable ASCII, and for quotes and path separators.
  const ascii = fileName.replaceAll(/[^\x20-\x7e]|["\\/]/gu, '_').trim()
  return ascii.length > 0 ? ascii : 'download'
}

/** A renderer-provided display name may suggest a download/reattachment name, never a path. */
export function preferredSessionResourceFileName(value: unknown) {
  if (typeof value !== 'string') return null
  const safe = truncateUtf8(
    value.trim().replaceAll(/[\\/:\p{Cc}]/gu, '_'),
    MAX_CONTENT_DISPOSITION_FILENAME_BYTES,
  ).trim()
  return safe.length === 0 || safe === '.' || safe === '..' ? null : safe
}

export function downloadContentDisposition(fileName: string) {
  const bounded = boundedDownloadFileName(fileName)
  const encoded = encodeURIComponent(bounded).replaceAll(
    /[!'()*]/gu,
    (character) => `%${character.codePointAt(0)?.toString(HEX_RADIX).toUpperCase() ?? ''}`,
  )
  return `attachment; filename="${safeDownloadFileName(bounded)}"; filename*=UTF-8''${encoded}`
}
