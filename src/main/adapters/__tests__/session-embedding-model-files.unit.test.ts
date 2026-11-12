import { createHash } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MultilingualE5SessionEmbeddingModel } from '../multilingual-e5-session-embedding-model'
import {
  type SessionEmbeddingModelAvailability,
  SessionEmbeddingModelFiles,
  SessionEmbeddingModelUnavailableError,
  SESSION_EMBEDDING_MODEL_RETRY_MS,
} from '../session-embedding-model-files'

const MODEL_ID = 'Org/tiny-model'
const REVISION = 'abc123'
const CONFIG = Buffer.from('{"hidden_size":4}')
const WEIGHTS = Buffer.alloc(5 * 1024 * 1024, 7)

function sha256(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex')
}

const FILES = [
  { path: 'config.json', sha256: sha256(CONFIG), bytes: CONFIG.byteLength },
  { path: 'onnx/model_quantized.onnx', sha256: sha256(WEIGHTS), bytes: WEIGHTS.byteLength },
]
const SERVED: Readonly<Record<string, Buffer>> = {
  'config.json': CONFIG,
  'onnx/model_quantized.onnx': WEIGHTS,
}

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-model-files-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

/** A model host that serves `SERVED` (or `override`) and records what was asked for. */
function modelHost(override: Partial<Record<string, Buffer | Error>> = {}) {
  const requested: string[] = []
  const fetch = async (url: string) => {
    requested.push(url)
    const file = url.slice(url.indexOf(`/resolve/${REVISION}/`) + `/resolve/${REVISION}/`.length)
    const body = override[file] ?? SERVED[file]
    if (body instanceof Error) throw body
    return body === undefined ? new Response(null, { status: 404 }) : new Response(body)
  }
  return { fetch, requested }
}

function store(input: {
  fetch: (url: string) => Promise<Response>
  now?: () => number
  bundled?: string
}) {
  return new SessionEmbeddingModelFiles({
    modelId: MODEL_ID,
    revision: REVISION,
    files: FILES,
    downloadDirectory: () => path.join(root, 'download'),
    ...(input.bundled === undefined ? {} : { bundledDirectory: input.bundled }),
    fetch: input.fetch,
    ...(input.now === undefined ? {} : { now: input.now }),
  })
}

function offlineError() {
  return new TypeError('fetch failed', {
    cause: Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' }),
  })
}

describe('Session embedding model files fetched on first use', () => {
  it('downloads the pinned revision once, verified, reporting progress, then reads it from disk', async () => {
    const host = modelHost()
    const files = store({ fetch: host.fetch })
    const seen: SessionEmbeddingModelAvailability[] = []
    files.onChange((availability) => seen.push(availability))

    expect(await files.present()).toBeNull()
    const [first, second] = await Promise.all([files.ensure(), files.ensure()])

    expect(first).toBe(path.join(root, 'download'))
    expect(second).toBe(first)
    expect(host.requested).toEqual([
      `https://huggingface.co/${MODEL_ID}/resolve/${REVISION}/config.json`,
      `https://huggingface.co/${MODEL_ID}/resolve/${REVISION}/onnx/model_quantized.onnx`,
    ])
    const weights = await fs.readFile(
      path.join(first, 'Org', 'tiny-model', 'onnx', 'model_quantized.onnx'),
    )
    expect(weights.equals(WEIGHTS)).toBe(true)
    expect(seen.at(0)).toEqual({
      state: 'downloading',
      receivedBytes: 0,
      totalBytes: files.totalBytes,
    })
    expect(seen.some((s) => s.state === 'downloading' && s.receivedBytes > 0)).toBe(true)
    expect(seen.at(-1)).toEqual({ state: 'ready' })

    const again = store({ fetch: modelHost().fetch })
    expect(await again.present()).toBe(first)
    expect(again.availability()).toEqual({ state: 'ready' })
  })

  it('uses a bundled copy without downloading', async () => {
    const host = modelHost()
    await store({ fetch: host.fetch }).ensure()
    const bundled = path.join(root, 'bundled')
    await fs.rename(path.join(root, 'download'), bundled)
    const unused = modelHost()

    expect(await store({ fetch: unused.fetch, bundled }).ensure()).toBe(bundled)
    expect(unused.requested).toEqual([])
  })

  it('refuses a file that fails its hash and leaves nothing a later start would trust', async () => {
    const files = store({
      fetch: modelHost({ 'onnx/model_quantized.onnx': Buffer.from('tampered') }).fetch,
    })

    const failure = await files.ensure().catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(SessionEmbeddingModelUnavailableError)
    expect(files.availability()).toMatchObject({
      state: 'failed',
      reason: expect.stringMatching(/integrity/),
    })
    const directory = path.join(root, 'download', 'Org', 'tiny-model')
    expect(await fs.readdir(path.join(directory, 'onnx'))).toEqual([])
    expect(await store({ fetch: modelHost().fetch }).present()).toBeNull()
  })

  it('reports offline and waits before trying again', async () => {
    let now = 1_000
    const offline = modelHost({ 'config.json': offlineError() })
    const files = store({ fetch: offline.fetch, now: () => now })

    await expect(files.ensure()).rejects.toThrow(/offline/)
    expect(files.availability()).toMatchObject({
      state: 'offline',
      retryAt: 1_000 + SESSION_EMBEDDING_MODEL_RETRY_MS,
    })
    await expect(files.ensure()).rejects.toBeInstanceOf(SessionEmbeddingModelUnavailableError)
    expect(offline.requested).toHaveLength(1)

    now += SESSION_EMBEDDING_MODEL_RETRY_MS
    await expect(files.ensure()).rejects.toThrow(/offline/)
    expect(offline.requested).toHaveLength(2)
  })

  it('reports an HTTP error as a failed download', async () => {
    const files = store({ fetch: async () => new Response('gone', { status: 503 }) })

    await expect(files.ensure()).rejects.toThrow(/HTTP 503/)
    expect(files.availability().state).toBe('failed')
  })
})

describe('the Session embedding model with files fetched on first use', () => {
  function answeringChild(configs: string[]) {
    return (config: string) => {
      configs.push(config)
      const events = new EventEmitter()
      const child = fromPartial<ChildProcess>({
        on: (event: string, listener: (...args: unknown[]) => void) => {
          events.on(event, listener)
          return child
        },
        send: (
          message: { readonly id: number; readonly texts: readonly string[] },
          callback?: (error: Error | null) => void,
        ) => {
          callback?.(null)
          const data = new Float32Array(message.texts.length * 384)
          queueMicrotask(() =>
            events.emit('message', {
              type: 'result',
              id: message.id,
              dims: [message.texts.length, 384],
              data,
            }),
          )
          return true
        },
        kill: () => true,
      })
      return child
    }
  }

  it('is unavailable until the files arrive, then embeds with the downloaded copy only', async () => {
    const configs: string[] = []
    const model = new MultilingualE5SessionEmbeddingModel({
      spawnChild: answeringChild(configs),
      transformersPath: '/unused',
    })
    model.useModelFiles(store({ fetch: modelHost().fetch }))

    expect(await model.availability()).toEqual({ state: 'missing' })
    expect(await model.embedPassages(['hello'])).toHaveLength(1)

    expect(await model.availability()).toEqual({ state: 'ready' })
    expect(JSON.parse(configs[0] ?? '{}')).toMatchObject({
      localModelPath: path.join(root, 'download'),
      allowRemoteModels: false,
    })
    model.dispose()
  })

  it('fails an embedding while the model cannot be downloaded', async () => {
    const configs: string[] = []
    const model = new MultilingualE5SessionEmbeddingModel({ spawnChild: answeringChild(configs) })
    model.useModelFiles(store({ fetch: modelHost({ 'config.json': offlineError() }).fetch }))

    await expect(model.embedQueries(['hello'])).rejects.toBeInstanceOf(
      SessionEmbeddingModelUnavailableError,
    )
    expect(configs).toEqual([])
  })
})
