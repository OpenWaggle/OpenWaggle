/** Split terminal input on Unicode code-point boundaries under a UTF-8 byte cap. */
export function chunkTerminalInput(data: string, maxBytes: number): readonly string[] {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError('Terminal input chunk size must be a positive safe integer.')
  }
  if (data.length === 0) return []

  const chunks: string[] = []
  let chunk = ''
  let chunkBytes = 0
  for (const codePoint of data) {
    const codePointBytes = Buffer.byteLength(codePoint, 'utf8')
    if (codePointBytes > maxBytes) {
      throw new RangeError('Terminal input chunk size cannot fit one Unicode code point.')
    }
    if (chunkBytes + codePointBytes > maxBytes) {
      chunks.push(chunk)
      chunk = ''
      chunkBytes = 0
    }
    chunk += codePoint
    chunkBytes += codePointBytes
  }
  if (chunk.length > 0) chunks.push(chunk)
  return chunks
}
