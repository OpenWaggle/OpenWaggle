import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MultilingualE5SessionEmbeddingModel } from '../multilingual-e5-session-embedding-model'
import { SessionEmbeddingModelFiles } from '../session-embedding-model-files'

const MODEL_ID = 'Org/tiny-model'
const REVISION = 'abc123'
const CONFIG = Buffer.from('{"hidden_size":4}')
const WEIGHTS = Buffer.alloc(1024, 7)
const SERVED: Readonly<Record<string, Buffer>> = {
  'config.json': CONFIG,
  'onnx/model_quantized.onnx': WEIGHTS,
}
const FILES = Object.entries(SERVED).map(([file, bytes]) => ({
  path: file,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  bytes: bytes.byteLength,
}))

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-model-background-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

function modelFiles(directory: string, gate: Promise<void> = Promise.resolve()) {
  const requested: string[] = []
  const files = new SessionEmbeddingModelFiles({
    modelId: MODEL_ID,
    revision: REVISION,
    files: FILES,
    downloadDirectory: () => path.join(root, directory),
    fetch: async (url) => {
      requested.push(url)
      await gate
      const body = SERVED[url.slice(url.indexOf(`/${REVISION}/`) + REVISION.length + 2)]
      return new Response(body === undefined ? null : new Uint8Array(body))
    },
  })
  const ready = new Promise<void>((resolve) => {
    files.onChange((availability) => {
      if (availability.state === 'ready') resolve()
    })
  })
  return { files, requested, ready }
}

describe('the Session embedding model download a readiness read starts', () => {
  it('holds the Host until the download ends', async () => {
    let arrive: () => void = () => undefined
    const download = modelFiles(
      'download',
      new Promise<void>((resolve) => {
        arrive = resolve
      }),
    )
    const model = new MultilingualE5SessionEmbeddingModel()
    model.useModelFiles(download.files)
    let held = 0
    model.holdDownloadsWith(() => {
      held += 1
      return () => {
        held -= 1
      }
    })

    expect(await model.availability()).toEqual({ state: 'missing' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(held).toBe(1)
    arrive()
    await download.ready
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(held).toBe(0)
  })

  it('starts no download when the Host refuses the hold', async () => {
    const download = modelFiles('download')
    const model = new MultilingualE5SessionEmbeddingModel()
    model.useModelFiles(download.files)
    model.holdDownloadsWith(() => {
      throw new Error('The Session Host is stopping')
    })

    expect(await model.availability()).toEqual({ state: 'missing' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(download.requested).toEqual([])
  })

  it('removes the partial files a killed download left before it downloads', async () => {
    const directory = path.join(root, 'download', 'Org', 'tiny-model')
    const stale = [
      path.join(directory, 'config.json.1b2c.download'),
      path.join(directory, 'onnx', 'model_quantized.onnx.3d4e.download'),
    ]
    await fs.mkdir(path.join(directory, 'onnx'), { recursive: true })
    await Promise.all(stale.map((file) => fs.writeFile(file, 'partial')))

    await modelFiles('download').files.ensure()

    const left = await fs.readdir(directory, { recursive: true })
    expect(left.filter((entry) => entry.endsWith('.download'))).toEqual([])
    expect(left).toContain(path.join('onnx', 'model_quantized.onnx'))
  })

  it('downloads past a partial file it cannot remove', async () => {
    const directory = path.join(root, 'download', 'Org', 'tiny-model')
    // A directory fails a non-recursive removal, as a file another process holds does.
    await fs.mkdir(path.join(directory, 'config.json.held.download'), { recursive: true })
    await fs.writeFile(path.join(directory, 'config.json.held.download', 'inner'), 'held')

    expect(await modelFiles('download').files.ensure()).toBe(path.join(root, 'download'))
  })
})

describe('the Session embedding model files hold', () => {
  it('is taken once by the download ensure() starts, for every caller, until it ends', async () => {
    let arrive: () => void = () => undefined
    const download = modelFiles(
      'download',
      new Promise<void>((resolve) => {
        arrive = resolve
      }),
    )
    const holds: string[] = []
    download.files.holdDownloadsWith(() => {
      holds.push('taken')
      return () => {
        holds.push('released')
      }
    })

    const both = Promise.all([download.files.ensure(), download.files.ensure()])
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(holds).toEqual(['taken'])
    arrive()
    await both

    expect(holds).toEqual(['taken', 'released'])
  })

  it('fails ensure() with nothing fetched when the hold is refused', async () => {
    const download = modelFiles('download')
    download.files.holdDownloadsWith(() => {
      throw new Error('The Session Host is stopping')
    })

    await expect(download.files.ensure()).rejects.toThrow('The Session Host is stopping')
    expect(download.requested).toEqual([])
  })
})
