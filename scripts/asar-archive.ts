/**
 * Reads the file index and file contents of an Electron `app.asar`, including files electron-builder
 * moved to `app.asar.unpacked`. Only what the native platform-floor guard needs: listing paths and
 * reading small files such as package.json.
 *
 * Layout: a 4-byte pickle header, the header pickle's size, then the header pickle (payload size,
 * JSON length, JSON). File data starts right after the header pickle, at the offsets the JSON gives.
 */
import fs from 'node:fs/promises'

interface AsarFileEntry {
  readonly size: number
  readonly offset: number | null
}

export interface AsarArchive {
  readonly files: ReadonlyMap<string, AsarFileEntry>
  readFile(archivePath: string): Promise<Buffer>
}

const HEADER_PICKLE_SIZE_OFFSET = 4
const JSON_LENGTH_OFFSET = 12
const JSON_OFFSET = 16
const DATA_BASE_OFFSET = 8
const MAX_HEADER_BYTES = 256 * 1024 * 1024

function isRecord(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fileEntry(node: { readonly [key: string]: unknown }, location: string): AsarFileEntry {
  if (typeof node.size !== 'number') throw new Error(`asar entry ${location} has no size.`)
  if (node.unpacked === true) return { size: node.size, offset: null }
  const offset = Number(node.offset)
  if (typeof node.offset !== 'string' || !Number.isSafeInteger(offset)) {
    throw new Error(`asar entry ${location} has no valid offset.`)
  }
  return { size: node.size, offset }
}

function collectFiles(node: unknown, location: string, files: Map<string, AsarFileEntry>) {
  if (!isRecord(node)) throw new Error(`asar entry ${location || '/'} is malformed.`)
  if (node.link !== undefined) return
  if (node.files === undefined) {
    files.set(location, fileEntry(node, location))
    return
  }
  if (!isRecord(node.files)) throw new Error(`asar directory ${location || '/'} is malformed.`)
  for (const [name, child] of Object.entries(node.files)) collectFiles(child, `${location}/${name}`, files)
}

export async function readAsarArchive(asarPath: string): Promise<AsarArchive> {
  const handle = await fs.open(asarPath, 'r')
  try {
    const prefix = Buffer.alloc(JSON_OFFSET)
    await handle.read(prefix, 0, JSON_OFFSET, 0)
    const jsonLength = prefix.readUInt32LE(JSON_LENGTH_OFFSET)
    if (jsonLength > MAX_HEADER_BYTES) throw new Error(`${asarPath} has an implausible header size.`)
    const json = Buffer.alloc(jsonLength)
    await handle.read(json, 0, jsonLength, JSON_OFFSET)
    const dataBase = DATA_BASE_OFFSET + prefix.readUInt32LE(HEADER_PICKLE_SIZE_OFFSET)
    const files = new Map<string, AsarFileEntry>()
    collectFiles(JSON.parse(json.toString('utf8')), '', files)
    return {
      files,
      async readFile(archivePath) {
        const entry = files.get(archivePath)
        if (entry === undefined) throw new Error(`${asarPath} has no ${archivePath}.`)
        if (entry.offset === null) return fs.readFile(`${asarPath}.unpacked${archivePath}`)
        const contents = Buffer.alloc(entry.size)
        const reader = await fs.open(asarPath, 'r')
        try {
          await reader.read(contents, 0, entry.size, dataBase + entry.offset)
        } finally {
          await reader.close()
        }
        return contents
      },
    }
  } finally {
    await handle.close()
  }
}
