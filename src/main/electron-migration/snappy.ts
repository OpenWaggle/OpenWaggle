/**
 * Snappy block decompression (the raw format, not the framed stream), which LevelDB uses for the
 * table blocks Chromium writes under `Local Storage/leveldb`. Only decompression is needed: the
 * migrator reads Electron's data and never writes LevelDB.
 * Format: https://github.com/google/snappy/blob/main/format_description.txt
 */
const TAG_TYPE_MASK = 0b11
const TAG_LITERAL = 0
const TAG_COPY_1 = 1
const TAG_COPY_2 = 2
const TAG_SHIFT = 2
const LITERAL_INLINE_MAX = 59
const COPY_1_LENGTH_MASK = 0b111
const COPY_1_MIN_LENGTH = 4
const COPY_1_OFFSET_HIGH_SHIFT = 5
const BYTE_BITS = 8
const VARINT_CONTINUATION = 0x80
const VARINT_PAYLOAD = 0x7f
const VARINT_SHIFT = 7
const MAX_VARINT32_SHIFT = 28
const TWO_BYTES = 2
const FOUR_BYTES = 4
const VARINT_BASE = 2

export class SnappyError extends Error {}

function readUncompressedLength(input: Uint8Array) {
  let value = 0
  let shift = 0
  let offset = 0
  while (offset < input.length) {
    const byte = input[offset] ?? 0
    offset += 1
    value += (byte & VARINT_PAYLOAD) * VARINT_BASE ** shift
    if ((byte & VARINT_CONTINUATION) === 0) return { length: value, offset }
    shift += VARINT_SHIFT
    if (shift > MAX_VARINT32_SHIFT) break
  }
  throw new SnappyError('Snappy block has an invalid length header.')
}

function littleEndian(input: Uint8Array, offset: number, bytes: number) {
  if (offset + bytes > input.length) throw new SnappyError('Snappy block ends inside a tag.')
  let value = 0
  for (let index = 0; index < bytes; index += 1) {
    value += (input[offset + index] ?? 0) * VARINT_BASE ** (BYTE_BITS * index)
  }
  return value
}

export function decompressSnappy(input: Uint8Array) {
  const header = readUncompressedLength(input)
  const output = new Uint8Array(header.length)
  let inputOffset = header.offset
  let outputOffset = 0
  while (inputOffset < input.length) {
    const tag = input[inputOffset] ?? 0
    inputOffset += 1
    const type = tag & TAG_TYPE_MASK
    if (type === TAG_LITERAL) {
      let length = tag >>> TAG_SHIFT
      if (length > LITERAL_INLINE_MAX) {
        const extraBytes = length - LITERAL_INLINE_MAX
        length = littleEndian(input, inputOffset, extraBytes)
        inputOffset += extraBytes
      }
      length += 1
      if (inputOffset + length > input.length || outputOffset + length > output.length) {
        throw new SnappyError('Snappy literal overruns its block.')
      }
      output.set(input.subarray(inputOffset, inputOffset + length), outputOffset)
      inputOffset += length
      outputOffset += length
      continue
    }
    let length: number
    let distance: number
    if (type === TAG_COPY_1) {
      length = ((tag >>> TAG_SHIFT) & COPY_1_LENGTH_MASK) + COPY_1_MIN_LENGTH
      distance =
        ((tag >>> COPY_1_OFFSET_HIGH_SHIFT) << BYTE_BITS) | littleEndian(input, inputOffset, 1)
      inputOffset += 1
    } else {
      const offsetBytes = type === TAG_COPY_2 ? TWO_BYTES : FOUR_BYTES
      length = (tag >>> TAG_SHIFT) + 1
      distance = littleEndian(input, inputOffset, offsetBytes)
      inputOffset += offsetBytes
    }
    if (distance === 0 || distance > outputOffset || outputOffset + length > output.length) {
      throw new SnappyError('Snappy copy points outside its block.')
    }
    // Copies may overlap their own output (a run), so they go byte by byte.
    for (let index = 0; index < length; index += 1) {
      output[outputOffset] = output[outputOffset - distance] ?? 0
      outputOffset += 1
    }
  }
  if (outputOffset !== output.length) {
    throw new SnappyError('Snappy block is shorter than declared.')
  }
  return output
}
