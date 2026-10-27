import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MultilingualE5SessionEmbeddingModel } from '../multilingual-e5-session-embedding-model'
import { EMBEDDING_INFERENCE_BATCH_SIZE } from '../sqlite-session-semantic-projection'
import { TRANSCRIPT_EMBEDDING_INFERENCE_BATCH_SIZE } from '../sqlite-session-transcript-semantic-projection'

/**
 * transformers.js stand-in: a pipeline that returns 384-dimension vectors whose first value is
 * the text's length, and records the process it runs in and the options it was loaded with.
 */
function fakeTransformers(directory: string) {
  const file = path.join(directory, 'fake-transformers.cjs')
  const record = path.join(directory, 'record.json')
  writeFileSync(
    file,
    `
const fs = require('node:fs')
exports.env = {}
exports.pipeline = async (task, model, options) => {
  fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ pid: process.pid, task, model, options, env: exports.env }))
  return async (texts) => {
    const data = new Float32Array(texts.length * 384)
    texts.forEach((text, index) => { data[index * 384] = text.length })
    return { dims: [texts.length, 384], data, dispose() {} }
  }
}
`,
  )
  return { file, record }
}

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

async function waitUntil(predicate: () => boolean, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('Session embedding off the Host (D3)', () => {
  it('embeds in a child process that exits when idle and starts again on demand', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'ow-embedding-'))
    directories.push(directory)
    const transformers = fakeTransformers(directory)
    const model = new MultilingualE5SessionEmbeddingModel({
      transformersPath: transformers.file,
      idleExitMs: 200,
    })
    model.configureRuntime({ localModelPath: '/models', allowRemoteModels: false })

    const vectors = await model.embedPassages(['ab', 'abcd'])
    expect(vectors.map((vector) => [vector.length, vector[0]])).toEqual([
      [384, 'passage: ab'.length],
      [384, 'passage: abcd'.length],
    ])
    const recorded = JSON.parse(readFileSync(transformers.record, 'utf8'))
    expect(recorded.pid).not.toBe(process.pid)
    expect(recorded).toMatchObject({
      task: 'feature-extraction',
      model: 'Xenova/multilingual-e5-small',
      options: { dtype: 'q8', session_options: { intraOpNumThreads: 2 } },
      env: { localModelPath: '/models', allowRemoteModels: false },
    })
    expect(model.isLoaded).toBe(true)

    await waitUntil(() => !model.isLoaded)
    const [query] = await model.embedQueries(['x'])
    expect(query?.[0]).toBe('query: x'.length)
    expect(model.dispose()).toBe(true)
    expect(model.isLoaded).toBe(false)
  })

  it('fails a pending embedding when the child cannot load the model', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'ow-embedding-'))
    directories.push(directory)
    const broken = path.join(directory, 'broken.cjs')
    writeFileSync(broken, "throw new Error('no onnxruntime here')")
    const model = new MultilingualE5SessionEmbeddingModel({ transformersPath: broken })
    await expect(model.embedPassages(['a'])).rejects.toThrow('no onnxruntime here')
  })

  it('embeds at most eight passages per inference call', () => {
    expect(EMBEDDING_INFERENCE_BATCH_SIZE).toBeLessThanOrEqual(8)
    expect(TRANSCRIPT_EMBEDDING_INFERENCE_BATCH_SIZE).toBeLessThanOrEqual(8)
  })
})
