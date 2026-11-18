import { createWriteStream } from 'node:fs'
import { chmod, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { type Entry, fromBufferPromise } from 'yauzl'

const MAX_ARCHIVE_ENTRIES = 10_000
const MAX_ENTRY_BYTES = 128 * 1_024 * 1_024
const MAX_EXTRACTED_BYTES = 256 * 1_024 * 1_024
const MAX_ENTRY_NAME_LENGTH = 1_024
const UNIX_FILE_TYPE_MASK = 0o170000
const UNIX_DIRECTORY = 0o040000
const UNIX_REGULAR_FILE = 0o100000
const UNIX_SYMBOLIC_LINK = 0o120000
const UNIX_MODE_SHIFT = 16
const UNIX_MODE_MASK = 0xffff
const UNIX_EXECUTABLE_MASK = 0o111
const DIRECTORY_MODE = 0o700
const REGULAR_FILE_MODE = 0o600

function unixMode(entry: Entry) {
  return (entry.externalFileAttributes >>> UNIX_MODE_SHIFT) & UNIX_MODE_MASK
}

function archivePath(entry: Entry) {
  const fileName = entry.fileName
  if (
    !fileName ||
    fileName.length > MAX_ENTRY_NAME_LENGTH ||
    fileName.includes('\\') ||
    fileName.includes('\0') ||
    path.posix.isAbsolute(fileName) ||
    /^[A-Za-z]:/.test(fileName)
  ) {
    throw new Error(`MCPB archive contains an unsafe path: ${JSON.stringify(fileName)}.`)
  }
  const normalized = fileName.endsWith('/') ? fileName.slice(0, -1) : fileName
  const segments = normalized.split('/')
  if (
    segments.length === 0 ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`MCPB archive contains an unsafe path: ${JSON.stringify(fileName)}.`)
  }
  return segments
}

function entryKind(entry: Entry) {
  const mode = unixMode(entry)
  const fileType = mode & UNIX_FILE_TYPE_MASK
  if (fileType === UNIX_SYMBOLIC_LINK) {
    throw new Error(`MCPB archive contains a symbolic link: ${entry.fileName}.`)
  }
  const directory = entry.fileName.endsWith('/') || fileType === UNIX_DIRECTORY
  if (fileType !== 0 && fileType !== UNIX_DIRECTORY && fileType !== UNIX_REGULAR_FILE) {
    throw new Error(`MCPB archive contains an unsupported special file: ${entry.fileName}.`)
  }
  if (directory && entry.uncompressedSize !== 0) {
    throw new Error(`MCPB archive directory contains file data: ${entry.fileName}.`)
  }
  return { directory, executable: (mode & UNIX_EXECUTABLE_MASK) !== 0 }
}

function validateEntrySize(entry: Entry, extractedBytes: number) {
  if (
    !Number.isSafeInteger(entry.uncompressedSize) ||
    entry.uncompressedSize < 0 ||
    entry.uncompressedSize > MAX_ENTRY_BYTES ||
    extractedBytes + entry.uncompressedSize > MAX_EXTRACTED_BYTES
  ) {
    throw new Error(`MCPB archive entry exceeded the extraction safety limit: ${entry.fileName}.`)
  }
  return extractedBytes + entry.uncompressedSize
}

export async function extractMcpbArchive(archive: Buffer, destination: string) {
  const zip = await fromBufferPromise(archive, {
    autoClose: false,
    decodeStrings: true,
    lazyEntries: true,
    strictFileNames: true,
    validateEntrySizes: true,
  })
  if (zip.entryCount > MAX_ARCHIVE_ENTRIES) {
    zip.close()
    throw new Error('MCPB archive exceeded the entry-count safety limit.')
  }

  let extractedBytes = 0
  let entryCount = 0
  try {
    for await (const entry of zip.eachEntry()) {
      entryCount += 1
      if (entryCount > MAX_ARCHIVE_ENTRIES) {
        throw new Error('MCPB archive exceeded the entry-count safety limit.')
      }
      if (entry.isEncrypted() || !entry.canDecodeFileData()) {
        throw new Error(`MCPB archive entry cannot be safely decoded: ${entry.fileName}.`)
      }
      extractedBytes = validateEntrySize(entry, extractedBytes)
      const segments = archivePath(entry)
      const target = path.join(destination, ...segments)
      const kind = entryKind(entry)
      if (kind.directory) {
        await mkdir(target, { recursive: true, mode: DIRECTORY_MODE })
        continue
      }

      await mkdir(path.dirname(target), { recursive: true, mode: DIRECTORY_MODE })
      const stream = await zip.openReadStreamPromise(entry)
      const fileMode = kind.executable ? DIRECTORY_MODE : REGULAR_FILE_MODE
      await pipeline(stream, createWriteStream(target, { flags: 'wx', mode: fileMode }))
      await chmod(target, fileMode)
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('MCPB archive')) throw error
    throw new Error(
      `MCPB archive contains an unsafe path or invalid ZIP metadata: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  } finally {
    zip.close()
  }
}
