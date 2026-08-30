import { createHash } from 'node:crypto'
import type { FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { match } from '@diegogbrisa/ts-match'
import { canonicalJson } from '@shared/canonical-json'
import {
  SESSION_EXPORT_BUNDLE_SCHEMA_VERSION,
  type SessionExportBundleEntry,
  type SessionExportBundleManifest,
  type SessionExportManifest,
} from '@shared/types/session-export'
import JSZip from 'jszip'

const BUNDLE_MANIFEST_PATH = 'manifest.json'
const BUNDLE_TRANSCRIPT_PATH = 'session.jsonl'
const LINE_FEED_BYTE = 10
const READ_BUFFER_BYTES = 1024 * 1024

export interface SessionExportBundleSource {
  readonly path: string
  readonly handle: FileHandle
}

async function* readHandle(source: SessionExportBundleSource) {
  const size = (await source.handle.stat()).size
  let position = 0
  while (position < size) {
    const buffer = Buffer.allocUnsafe(Math.min(READ_BUFFER_BYTES, size - position))
    const { bytesRead } = await source.handle.read(buffer, 0, buffer.length, position)
    if (bytesRead === 0) throw new Error(`Bundle entry became unreadable: ${source.path}`)
    position += bytesRead
    yield bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead)
  }
}

async function sha256(source: SessionExportBundleSource) {
  const hash = createHash('sha256')
  for await (const chunk of readHandle(source)) hash.update(chunk)
  return hash.digest('hex')
}

function mediaType(filePath: string) {
  if (filePath === BUNDLE_TRANSCRIPT_PATH) return 'application/x-ndjson'
  return match(path.extname(filePath).toLowerCase())
    .with('.json', () => 'application/json')
    .with('.md', '.markdown', () => 'text/markdown; charset=utf-8')
    .with('.txt', () => 'text/plain; charset=utf-8')
    .with('.pdf', () => 'application/pdf')
    .with('.png', () => 'image/png')
    .with('.jpg', '.jpeg', () => 'image/jpeg')
    .with('.webp', () => 'image/webp')
    .otherwise(() => 'application/octet-stream')
}

async function bundleEntry(source: SessionExportBundleSource): Promise<SessionExportBundleEntry> {
  return {
    path: source.path,
    mediaType: mediaType(source.path),
    size: (await source.handle.stat()).size,
    sha256: await sha256(source),
  }
}

function recordKind(value: unknown) {
  if (typeof value !== 'object' || value === null || !('record' in value)) return undefined
  return value.record
}

async function validateTranscript(source: SessionExportBundleSource) {
  const transcriptStat = await source.handle.stat()
  if (transcriptStat.size === 0) throw new Error('Bundle transcript is empty.')
  const trailing = Buffer.alloc(1)
  await source.handle.read(trailing, 0, trailing.length, transcriptStat.size - trailing.length)
  if (trailing[0] !== LINE_FEED_BYTE) {
    throw new Error('Bundle transcript must end with a newline.')
  }
  const lines = createInterface({
    input: Readable.from(readHandle(source)),
    crlfDelay: Number.POSITIVE_INFINITY,
  })
  let lineNumber = 0
  for await (const line of lines) {
    lineNumber += 1
    if (!line) throw new Error(`Bundle transcript contains an empty record at line ${lineNumber}.`)
    const kind = recordKind(JSON.parse(line))
    if (lineNumber === 1 && kind !== 'manifest') {
      throw new Error('Bundle transcript must start with the export manifest record.')
    }
    if (lineNumber > 1 && kind !== 'node') {
      throw new Error(`Bundle transcript contains an invalid record at line ${lineNumber}.`)
    }
  }
}

function writableHandle(handle: FileHandle) {
  let position = 0
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      const writeAll = async () => {
        let offset = 0
        while (offset < buffer.length) {
          const { bytesWritten } = await handle.write(
            buffer,
            offset,
            buffer.length - offset,
            position,
          )
          if (bytesWritten === 0) throw new Error('Bundle write made no progress.')
          offset += bytesWritten
          position += bytesWritten
        }
      }
      void writeAll().then(() => callback(), callback)
    },
  })
}

export async function finalizeSessionExportBundle(input: {
  readonly sources: readonly SessionExportBundleSource[]
  readonly destinationHandle: FileHandle
  readonly exportManifest: SessionExportManifest
}) {
  const transcript = input.sources.find((source) => source.path === BUNDLE_TRANSCRIPT_PATH)
  if (!transcript) throw new Error('Bundle transcript is missing.')
  await validateTranscript(transcript)
  const entries = await Promise.all(
    [...input.sources]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((source) => bundleEntry(source)),
  )
  const manifest = {
    schemaVersion: SESSION_EXPORT_BUNDLE_SCHEMA_VERSION,
    kind: 'openwaggle-session-export-bundle',
    export: input.exportManifest,
    entries,
  } satisfies SessionExportBundleManifest

  const zip = new JSZip()
  for (const source of input.sources) {
    zip.file(source.path, Readable.from(readHandle(source)))
  }
  zip.file(BUNDLE_MANIFEST_PATH, `${canonicalJson(manifest)}\n`)
  await pipeline(
    zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'DEFLATE' }),
    writableHandle(input.destinationHandle),
  )
  await input.destinationHandle.sync()
}
