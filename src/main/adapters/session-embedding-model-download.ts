/**
 * Writing one pinned model file (session-embedding-model-files.ts): streamed into a uniquely named
 * `<file>.<uuid>.download` beside its target, hashed as it arrives and renamed into place only when
 * its SHA-256 matches. A process that dies mid-download leaves its partial file behind;
 * `removeStaleDownloads` clears those before the next download starts.
 */
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const PARTIAL_SUFFIX = '.download'
const HTTP_OK_MINIMUM = 200
const HTTP_OK_MAXIMUM = 299

export interface ModelFileDownload {
  readonly url: string
  readonly path: string
  readonly sha256: string
  readonly target: string
  readonly fetch: (url: string) => Promise<Response>
  readonly progress: (bytes: number) => void
}

export async function fileHashMatches(filePath: string, sha256: string) {
  const hash = createHash('sha256')
  const stream = (await fs.open(filePath)).createReadStream()
  for await (const chunk of stream) {
    if (chunk instanceof Uint8Array) hash.update(chunk)
  }
  return hash.digest('hex') === sha256
}

/** Removes every partial download under `directory`; none is in progress when this runs. */
export async function removeStaleDownloads(directory: string) {
  const entries = await fs.readdir(directory, { recursive: true }).catch(() => [])
  const stale = entries.filter((entry) => entry.endsWith(PARTIAL_SUFFIX))
  await Promise.all(stale.map((entry) => fs.rm(path.join(directory, entry), { force: true })))
}

export async function downloadModelFile(download: ModelFileDownload) {
  const response = await download.fetch(download.url)
  if (response.status < HTTP_OK_MINIMUM || response.status > HTTP_OK_MAXIMUM) {
    throw new Error(`${download.path}: HTTP ${String(response.status)}`)
  }
  if (response.body === null) throw new Error(`${download.path}: empty response`)
  await fs.mkdir(path.dirname(download.target), { recursive: true })
  const partial = `${download.target}.${randomUUID()}${PARTIAL_SUFFIX}`
  const hash = createHash('sha256')
  try {
    const reader = response.body.getReader()
    const handle = await fs.open(partial, 'w')
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        hash.update(chunk.value)
        download.progress(chunk.value.byteLength)
        await handle.write(chunk.value)
      }
    } finally {
      await handle.close()
    }
    const actual = hash.digest('hex')
    if (actual !== download.sha256) {
      throw new Error(`${download.path} failed its integrity check (SHA-256 ${actual})`)
    }
    await fs.rename(partial, download.target)
  } finally {
    await fs.rm(partial, { force: true })
  }
}
