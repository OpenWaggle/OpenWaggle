/**
 * The Session embedding model's files, fetched on first use instead of shipped with the app. The
 * app no longer carries the ~135 MB multilingual-e5 model (installer, update and installed size);
 * the first embedding downloads it once into userData, which updates keep, from the pinned Hugging
 * Face revision, and checks every file against its pinned SHA-256 before it is used.
 *
 * Until the files are there, semantic discovery is not usable and search stays lexical
 * (`SqliteSessionSemanticSearch.usable`). A failed download (offline, an HTTP error, a file that
 * fails its hash) is reported through `availability()` and retried no sooner than
 * `sessionEmbeddingModelRetryDelayMs` later: 15 s after the first failure, doubling with each
 * failure in a row up to 30 minutes, so the background loop and searches do not hammer the network
 * and a long outage costs a request every half hour. A copy bundled with the app (an older package, or a build that still ships it) is used
 * when present, without a download.
 */
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { matchBy } from '@diegogbrisa/ts-match'

export interface SessionEmbeddingModelFile {
  readonly path: string
  readonly sha256: string
  readonly bytes: number
}

export type SessionEmbeddingModelAvailability =
  | { readonly state: 'missing' }
  | { readonly state: 'downloading'; readonly receivedBytes: number; readonly totalBytes: number }
  | { readonly state: 'ready' }
  | ({ readonly state: 'offline' } & SessionEmbeddingModelFailure)
  | ({ readonly state: 'failed' } & SessionEmbeddingModelFailure)

export interface SessionEmbeddingModelFailure {
  readonly reason: string
  /** Epoch ms after which the next use tries the download again. */
  readonly retryAt: number
}

export const SESSION_EMBEDDING_MODEL_HOST = 'https://huggingface.co'
export const SESSION_EMBEDDING_MODEL_RETRY_BASE_MS = 15_000
export const SESSION_EMBEDDING_MODEL_RETRY_CAP_MS = 30 * 60_000
const RETRY_GROWTH = 2

/** How long to wait after the `failures`-th failed download in a row (1 for the first). */
export function sessionEmbeddingModelRetryDelayMs(failures: number) {
  const doublings = Math.max(0, failures - 1)
  return Math.min(
    SESSION_EMBEDDING_MODEL_RETRY_BASE_MS * RETRY_GROWTH ** doublings,
    SESSION_EMBEDDING_MODEL_RETRY_CAP_MS,
  )
}
/** The record of a verified download; its presence and the file sizes stand for the hashes. */
const VERIFIED_MANIFEST = 'openwaggle-model-manifest.json'
/** Progress is reported at most this often (bytes), so listeners are not called per chunk. */
const PROGRESS_STEP_BYTES = 4 * 1024 * 1024
const JSON_INDENT = 2
const HTTP_OK_MINIMUM = 200
const HTTP_OK_MAXIMUM = 299

/** Network failures Node's and Bun's fetch report, and DNS or socket codes under them. */
const OFFLINE_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'ConnectionRefused',
])

export class SessionEmbeddingModelUnavailableError extends Error {
  readonly availability: SessionEmbeddingModelAvailability

  constructor(availability: SessionEmbeddingModelAvailability, options?: ErrorOptions) {
    super(describeAvailability(availability), options)
    this.name = 'SessionEmbeddingModelUnavailableError'
    this.availability = availability
  }
}

const BYTES_PER_MB = 1_000_000
const PERCENT = 100

export function describeAvailability(availability: SessionEmbeddingModelAvailability) {
  return matchBy(availability, 'state')
    .with('ready', () => 'The Session search model is ready.')
    .with(
      'missing',
      () =>
        'The Session search model has not been downloaded yet; search matches words until it is.',
    )
    .with('downloading', (current) => {
      const percent = Math.floor((current.receivedBytes / current.totalBytes) * PERCENT)
      const total = Math.round(current.totalBytes / BYTES_PER_MB)
      return `Downloading the Session search model (${String(percent)}% of ${String(total)} MB); search matches words until it arrives.`
    })
    .with(
      'offline',
      (current) =>
        `The Session search model could not be downloaded while offline (${current.reason}); search matches words until it arrives.`,
    )
    .with(
      'failed',
      (current) =>
        `The Session search model download failed (${current.reason}); search matches words until it arrives.`,
    )
    .exhaustive()
}

function errorCode(error: unknown) {
  let current: unknown = error
  while (typeof current === 'object' && current !== null) {
    const code: unknown = Reflect.get(current, 'code')
    if (typeof code === 'string') return code
    current = Reflect.get(current, 'cause')
  }
  return undefined
}

function isOffline(error: unknown) {
  const code = errorCode(error)
  if (code !== undefined) return OFFLINE_CODES.has(code)
  return (
    error instanceof TypeError && /fetch failed|network|unable to connect/iu.test(error.message)
  )
}

async function fileSize(filePath: string) {
  try {
    return (await fs.stat(filePath)).size
  } catch {
    return null
  }
}

export interface SessionEmbeddingModelFilesOptions {
  readonly modelId: string
  readonly revision: string
  readonly files: readonly SessionEmbeddingModelFile[]
  /** The download root (transformers.js `localModelPath`); resolved when first needed. */
  readonly downloadDirectory: () => string
  /** A copy shipped with the app (its `localModelPath`), used instead of downloading. */
  readonly bundledDirectory?: string
  readonly host?: string
  readonly fetch?: (url: string) => Promise<Response>
  readonly now?: () => number
}

export class SessionEmbeddingModelFiles {
  readonly #options: SessionEmbeddingModelFilesOptions
  readonly #listeners = new Set<(availability: SessionEmbeddingModelAvailability) => void>()
  #availability: SessionEmbeddingModelAvailability = { state: 'missing' }
  #resolved: string | null = null
  #download: Promise<string> | null = null
  /** Failed downloads so far, which set the next retry's delay; a success ends the downloads. */
  #failures = 0

  constructor(options: SessionEmbeddingModelFilesOptions) {
    this.#options = options
  }

  get totalBytes() {
    return this.#options.files.reduce((total, file) => total + file.bytes, 0)
  }

  availability() {
    return this.#availability
  }

  /** Calls `listener` on every state change and progress step; returns the unsubscribe. */
  onChange(listener: (availability: SessionEmbeddingModelAvailability) => void) {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /**
   * The `localModelPath` that holds verified files, checking the disk without downloading: the
   * bundled copy, else a finished download. `null` when neither is there.
   */
  async present() {
    if (this.#resolved !== null) return this.#resolved
    for (const root of this.#roots()) {
      if (await this.#complete(root)) {
        this.#resolved = root
        this.#set({ state: 'ready' })
        return root
      }
    }
    return null
  }

  /** The `localModelPath` with verified files, downloading them once if they are not there. */
  async ensure() {
    const present = await this.present()
    if (present !== null) return present
    const current = this.#availability
    const now = (this.#options.now ?? Date.now)()
    if ((current.state === 'offline' || current.state === 'failed') && now < current.retryAt) {
      throw new SessionEmbeddingModelUnavailableError(current)
    }
    this.#download ??= this.#fetchAll().finally(() => {
      this.#download = null
    })
    return this.#download
  }

  #roots() {
    const bundled = this.#options.bundledDirectory
    return [...(bundled === undefined ? [] : [bundled]), this.#options.downloadDirectory()]
  }

  #modelDirectory(root: string) {
    return path.join(root, ...this.#options.modelId.split('/'))
  }

  async #complete(root: string) {
    const directory = this.#modelDirectory(root)
    if ((await fileSize(path.join(directory, VERIFIED_MANIFEST))) === null) return false
    for (const file of this.#options.files) {
      if ((await fileSize(path.join(directory, file.path))) !== file.bytes) return false
    }
    return true
  }

  #set(availability: SessionEmbeddingModelAvailability) {
    this.#availability = availability
    for (const listener of this.#listeners) listener(availability)
  }

  async #fetchAll() {
    const root = this.#options.downloadDirectory()
    const directory = this.#modelDirectory(root)
    const totalBytes = this.totalBytes
    let receivedBytes = 0
    let reportedAt = 0
    const progress = (bytes: number) => {
      receivedBytes += bytes
      if (receivedBytes - reportedAt < PROGRESS_STEP_BYTES) return
      reportedAt = receivedBytes
      this.#set({ state: 'downloading', receivedBytes, totalBytes })
    }
    this.#set({ state: 'downloading', receivedBytes, totalBytes })
    try {
      for (const file of this.#options.files) {
        const target = path.join(directory, file.path)
        if ((await fileSize(target)) === file.bytes && (await this.#hashMatches(target, file))) {
          progress(file.bytes)
          continue
        }
        await this.#fetchFile(file, target, progress)
      }
      await fs.writeFile(
        path.join(directory, VERIFIED_MANIFEST),
        `${JSON.stringify({ id: this.#options.modelId, revision: this.#options.revision, files: this.#options.files }, null, JSON_INDENT)}\n`,
      )
    } catch (error) {
      this.#failures += 1
      const retryAt =
        (this.#options.now ?? Date.now)() + sessionEmbeddingModelRetryDelayMs(this.#failures)
      const reason = error instanceof Error ? error.message : String(error)
      const failed: SessionEmbeddingModelAvailability = isOffline(error)
        ? { state: 'offline', reason, retryAt }
        : { state: 'failed', reason, retryAt }
      this.#set(failed)
      throw new SessionEmbeddingModelUnavailableError(failed, { cause: error })
    }
    this.#resolved = root
    this.#set({ state: 'ready' })
    return root
  }

  async #hashMatches(filePath: string, file: SessionEmbeddingModelFile) {
    const hash = createHash('sha256')
    const stream = (await fs.open(filePath)).createReadStream()
    for await (const chunk of stream) {
      if (chunk instanceof Uint8Array) hash.update(chunk)
    }
    return hash.digest('hex') === file.sha256
  }

  async #fetchFile(
    file: SessionEmbeddingModelFile,
    target: string,
    progress: (bytes: number) => void,
  ) {
    const encoded = file.path.split('/').map(encodeURIComponent).join('/')
    const host = this.#options.host ?? SESSION_EMBEDDING_MODEL_HOST
    const url = `${host}/${this.#options.modelId}/resolve/${this.#options.revision}/${encoded}`
    const response = await (this.#options.fetch ?? fetch)(url)
    if (response.status < HTTP_OK_MINIMUM || response.status > HTTP_OK_MAXIMUM) {
      throw new Error(`${file.path}: HTTP ${String(response.status)}`)
    }
    if (response.body === null) throw new Error(`${file.path}: empty response`)
    await fs.mkdir(path.dirname(target), { recursive: true })
    const partial = `${target}.${randomUUID()}.download`
    const hash = createHash('sha256')
    try {
      const reader = response.body.getReader()
      const handle = await fs.open(partial, 'w')
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          hash.update(chunk.value)
          progress(chunk.value.byteLength)
          await handle.write(chunk.value)
        }
      } finally {
        await handle.close()
      }
      const actual = hash.digest('hex')
      if (actual !== file.sha256) {
        throw new Error(`${file.path} failed its integrity check (SHA-256 ${actual})`)
      }
      await fs.rename(partial, target)
    } finally {
      await fs.rm(partial, { force: true })
    }
  }
}
