/**
 * LevelDB's on-disk records: the log format (write-ahead logs and the MANIFEST), write batches,
 * and sorted-table blocks. Format: https://github.com/google/leveldb/blob/main/doc/
 */
import { match } from '@diegogbrisa/ts-match'
import { decompressSnappy } from './snappy'

const LOG_BLOCK_BYTES = 32_768
const LOG_HEADER_BYTES = 7
const LOG_LENGTH_OFFSET = 4
const LOG_TYPE_OFFSET = 6
const LOG_FULL = 1
const LOG_FIRST = 2
const LOG_MIDDLE = 3
const LOG_LAST = 4
const BATCH_HEADER_BYTES = 12
const BATCH_COUNT_OFFSET = 8
const VALUE_TAG = 1
const DELETION_TAG = 0
const INTERNAL_KEY_TRAILER_BYTES = 8
const UINT32_BYTES = 4
const SEQUENCE_LOW_SHIFT = 8
const SEQUENCE_HIGH_FACTOR = 2 ** 24
const TYPE_MASK = 0xff
const FOOTER_BYTES = 48
const TABLE_MAGIC_LOW = 0x8b80fb57
const TABLE_MAGIC_HIGH = 0xdb477524
const BLOCK_TRAILER_BYTES = 5
const BLOCK_NO_COMPRESSION = 0
const BLOCK_SNAPPY = 1
const VARINT_CONTINUATION = 0x80
const VARINT_PAYLOAD = 0x7f
const VARINT_SHIFT = 7
const MAX_VARINT64_SHIFT = 63
const VARINT_BASE = 2
const CRC32C_POLYNOMIAL = 0x82f63b78
const CRC_TABLE_SIZE = 256
const BYTE_BITS = 8
const CRC_MASK_DELTA = 0xa282ead8
const CRC_MASK_ROTATE = 15
const CRC_MASK_ROTATE_LEFT = 17
const UINT32_MODULUS = 2 ** 32

export class LevelDbError extends Error {}

export interface InternalRecord {
  readonly key: Buffer
  readonly sequence: number
  /** Null for a deletion tombstone. */
  readonly value: Buffer | null
}

const CRC32C_TABLE = (() => {
  const table = new Uint32Array(CRC_TABLE_SIZE)
  for (let index = 0; index < CRC_TABLE_SIZE; index += 1) {
    let crc = index
    for (let bit = 0; bit < BYTE_BITS; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ CRC32C_POLYNOMIAL : crc >>> 1
    }
    table[index] = crc >>> 0
  }
  return table
})()

function crc32c(parts: readonly Uint8Array[]) {
  let crc = ~0 >>> 0
  for (const part of parts) {
    for (const byte of part) {
      crc = (CRC32C_TABLE[(crc ^ byte) & TYPE_MASK] ?? 0) ^ (crc >>> BYTE_BITS)
    }
  }
  return ~crc >>> 0
}

function unmaskCrc(masked: number) {
  const rotated = (masked - CRC_MASK_DELTA + UINT32_MODULUS) % UINT32_MODULUS
  return ((rotated >>> CRC_MASK_ROTATE_LEFT) | (rotated << CRC_MASK_ROTATE)) >>> 0
}

export class Cursor {
  offset = 0
  readonly bytes: Buffer

  constructor(bytes: Buffer) {
    this.bytes = bytes
  }

  get done() {
    return this.offset >= this.bytes.length
  }

  varint() {
    let value = 0
    let shift = 0
    while (this.offset < this.bytes.length) {
      const byte = this.bytes[this.offset] ?? 0
      this.offset += 1
      value += (byte & VARINT_PAYLOAD) * VARINT_BASE ** shift
      if ((byte & VARINT_CONTINUATION) === 0) return value
      shift += VARINT_SHIFT
      if (shift > MAX_VARINT64_SHIFT) break
    }
    throw new LevelDbError('LevelDB varint is truncated or too long.')
  }

  take(length: number) {
    if (this.offset + length > this.bytes.length) {
      throw new LevelDbError('LevelDB record ends early.')
    }
    const slice = this.bytes.subarray(this.offset, this.offset + length)
    this.offset += length
    return slice
  }

  lengthPrefixed() {
    return this.take(this.varint())
  }
}

/** A full record, or one fragment of a record split across log blocks. */
function assembleFragment(
  records: Buffer[],
  pending: readonly Buffer[] | null,
  type: number,
  payload: Buffer,
) {
  return match(type)
    .with(LOG_FULL, () => {
      records.push(Buffer.from(payload))
      return null
    })
    .with(LOG_FIRST, () => [payload])
    .with(LOG_MIDDLE, () => (pending ? [...pending, payload] : null))
    .with(LOG_LAST, () => {
      if (pending) records.push(Buffer.concat([...pending, payload]))
      return null
    })
    .otherwise(() => null)
}

/** The records of a LevelDB log file; a corrupt or torn record is skipped, as LevelDB does. */
export function readLogRecords(file: Buffer) {
  const records: Buffer[] = []
  let pending: readonly Buffer[] | null = null
  for (let blockStart = 0; blockStart < file.length; blockStart += LOG_BLOCK_BYTES) {
    const blockEnd = Math.min(blockStart + LOG_BLOCK_BYTES, file.length)
    let offset = blockStart
    while (blockEnd - offset >= LOG_HEADER_BYTES) {
      const length = file.readUInt16LE(offset + LOG_LENGTH_OFFSET)
      const type = file[offset + LOG_TYPE_OFFSET] ?? 0
      const payloadStart = offset + LOG_HEADER_BYTES
      // A zero type is preallocated padding; a record past the block is a torn write.
      if (type === 0 || payloadStart + length > blockEnd) break
      const payload = file.subarray(payloadStart, payloadStart + length)
      const expected = unmaskCrc(file.readUInt32LE(offset))
      offset = payloadStart + length
      if (crc32c([Uint8Array.of(type), payload]) !== expected) {
        pending = null
        break
      }
      pending = assembleFragment(records, pending, type, payload)
    }
  }
  return records
}

export function readWriteBatch(batch: Buffer, into: InternalRecord[]) {
  if (batch.length < BATCH_HEADER_BYTES) throw new LevelDbError('LevelDB write batch is truncated.')
  const firstSequence = readSequence(batch, 0)
  const count = batch.readUInt32LE(BATCH_COUNT_OFFSET)
  const cursor = new Cursor(batch)
  cursor.offset = BATCH_HEADER_BYTES
  for (let index = 0; index < count; index += 1) {
    const tag = cursor.take(1)[0]
    const key = Buffer.from(cursor.lengthPrefixed())
    const sequence = firstSequence + index
    if (tag !== VALUE_TAG && tag !== DELETION_TAG) {
      throw new LevelDbError(`LevelDB write batch has an unknown record type ${String(tag)}.`)
    }
    const value = tag === VALUE_TAG ? Buffer.from(cursor.lengthPrefixed()) : null
    into.push({ key, sequence, value })
  }
}

function readSequence(bytes: Buffer, offset: number) {
  return bytes.readUInt32LE(offset) + bytes.readUInt32LE(offset + UINT32_BYTES) * UINT32_MODULUS
}

function parseInternalKey(internalKey: Buffer, value: Buffer) {
  if (internalKey.length < INTERNAL_KEY_TRAILER_BYTES) {
    throw new LevelDbError('LevelDB internal key is too short.')
  }
  const trailerOffset = internalKey.length - INTERNAL_KEY_TRAILER_BYTES
  const low = internalKey.readUInt32LE(trailerOffset)
  const high = internalKey.readUInt32LE(trailerOffset + UINT32_BYTES)
  const type = low & TYPE_MASK
  const sequence = (low >>> SEQUENCE_LOW_SHIFT) + high * SEQUENCE_HIGH_FACTOR
  const key = Buffer.from(internalKey.subarray(0, trailerOffset))
  return { key, sequence, value: type === VALUE_TAG ? Buffer.from(value) : null }
}

function blockEntries(block: Buffer) {
  if (block.length < UINT32_BYTES) throw new LevelDbError('LevelDB block is truncated.')
  const restarts = block.readUInt32LE(block.length - UINT32_BYTES)
  const entriesEnd = block.length - UINT32_BYTES * (restarts + 1)
  if (entriesEnd < 0) throw new LevelDbError('LevelDB block has an invalid restart array.')
  const cursor = new Cursor(block.subarray(0, entriesEnd))
  const entries: { key: Buffer; value: Buffer }[] = []
  let previousKey = Buffer.alloc(0)
  while (!cursor.done) {
    const shared = cursor.varint()
    const unshared = cursor.varint()
    const valueLength = cursor.varint()
    if (shared > previousKey.length) throw new LevelDbError('LevelDB block key prefix is invalid.')
    const key = Buffer.concat([previousKey.subarray(0, shared), cursor.take(unshared)])
    entries.push({ key, value: cursor.take(valueLength) })
    previousKey = key
  }
  return entries
}

function readBlock(table: Buffer, handle: Cursor) {
  const offset = handle.varint()
  const size = handle.varint()
  if (offset + size + BLOCK_TRAILER_BYTES > table.length) {
    throw new LevelDbError('LevelDB block handle points outside its table.')
  }
  const contents = table.subarray(offset, offset + size)
  const type = table[offset + size] ?? 0
  const expected = unmaskCrc(table.readUInt32LE(offset + size + 1))
  if (crc32c([contents, Uint8Array.of(type)]) !== expected) {
    throw new LevelDbError('LevelDB block checksum does not match.')
  }
  if (type === BLOCK_NO_COMPRESSION) return contents
  if (type === BLOCK_SNAPPY) return Buffer.from(decompressSnappy(contents))
  throw new LevelDbError(`LevelDB block uses unsupported compression ${String(type)}.`)
}

export function readTableRecords(table: Buffer) {
  if (table.length < FOOTER_BYTES) throw new LevelDbError('LevelDB table is truncated.')
  const footer = table.subarray(table.length - FOOTER_BYTES)
  const magicOffset = FOOTER_BYTES - INTERNAL_KEY_TRAILER_BYTES
  if (
    footer.readUInt32LE(magicOffset) !== TABLE_MAGIC_LOW ||
    footer.readUInt32LE(magicOffset + UINT32_BYTES) !== TABLE_MAGIC_HIGH
  ) {
    throw new LevelDbError('LevelDB table has no valid footer.')
  }
  const handles = new Cursor(footer)
  handles.varint() // metaindex offset
  handles.varint() // metaindex size
  const records: InternalRecord[] = []
  for (const indexEntry of blockEntries(readBlock(table, handles))) {
    for (const entry of blockEntries(readBlock(table, new Cursor(indexEntry.value)))) {
      records.push(parseInternalKey(entry.key, entry.value))
    }
  }
  return records
}
