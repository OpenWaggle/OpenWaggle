const MAX_CONTENT_DISPOSITION_FILENAME_BYTES = 180
const ASCII_PRINTABLE_MIN = 0x20
const ASCII_PRINTABLE_MAX = 0x7e
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
  const ascii = [...fileName]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint >= ASCII_PRINTABLE_MIN &&
        codePoint <= ASCII_PRINTABLE_MAX &&
        !'"\\/'.includes(character)
        ? character
        : '_'
    })
    .join('')
    .trim()
  return ascii.length > 0 ? ascii : 'download'
}

export function downloadContentDisposition(fileName: string) {
  const bounded = boundedDownloadFileName(fileName)
  const encoded = encodeURIComponent(bounded).replaceAll(
    /[!'()*]/gu,
    (character) => `%${character.codePointAt(0)?.toString(HEX_RADIX).toUpperCase() ?? ''}`,
  )
  return `attachment; filename="${safeDownloadFileName(bounded)}"; filename*=UTF-8''${encoded}`
}
