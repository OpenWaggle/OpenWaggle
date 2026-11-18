import { ATTACHMENT } from '@shared/constants/resource-limits'
import type { Entry, ZipFile } from 'yauzl'
import { attachmentExtractionTimeoutError } from './attachment-extraction-scheduler'

async function openOfficeArchive(buffer: Buffer) {
  const yauzl = await import('yauzl')
  return await new Promise<ZipFile>((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      {
        autoClose: false,
        decodeStrings: true,
        lazyEntries: true,
        validateEntrySizes: true,
      },
      (error, zipFile) => {
        if (error) {
          reject(error)
          return
        }
        resolve(zipFile)
      },
    )
  })
}

async function countArchiveEntryBytes(
  zipFile: ZipFile,
  entry: Entry,
  remainingBytes: number,
  signal: AbortSignal,
) {
  if (entry.uncompressedSize > remainingBytes) {
    throw new Error(
      `Office attachment expands beyond ${String(ATTACHMENT.MAX_ARCHIVE_EXPANDED_BYTES)} bytes.`,
    )
  }
  const stream = await zipFile.openReadStreamPromise(entry)
  const abortStream = () => {
    stream.destroy()
  }
  if (signal.aborted) {
    abortStream()
    throw attachmentExtractionTimeoutError()
  }
  signal.addEventListener('abort', abortStream, { once: true })
  let expandedBytes = 0
  try {
    for await (const chunk of stream) {
      if (!Buffer.isBuffer(chunk)) {
        throw new Error('Office attachment produced an invalid archive data chunk.')
      }
      expandedBytes += chunk.byteLength
      if (expandedBytes > remainingBytes) {
        throw new Error(
          `Office attachment expands beyond ${String(ATTACHMENT.MAX_ARCHIVE_EXPANDED_BYTES)} bytes.`,
        )
      }
    }
    if (signal.aborted) throw attachmentExtractionTimeoutError()
    return expandedBytes
  } finally {
    signal.removeEventListener('abort', abortStream)
    stream.destroy()
  }
}

export async function validateOfficeArchive(buffer: Buffer, signal: AbortSignal) {
  const zipFile = await openOfficeArchive(buffer)
  try {
    if (zipFile.entryCount > ATTACHMENT.MAX_ARCHIVE_ENTRY_COUNT) {
      throw new Error(
        `Office attachment contains more than ${String(ATTACHMENT.MAX_ARCHIVE_ENTRY_COUNT)} archive entries.`,
      )
    }
    let expandedBytes = 0
    for await (const entry of zipFile.eachEntry()) {
      expandedBytes += await countArchiveEntryBytes(
        zipFile,
        entry,
        ATTACHMENT.MAX_ARCHIVE_EXPANDED_BYTES - expandedBytes,
        signal,
      )
    }
  } finally {
    zipFile.close()
  }
}
