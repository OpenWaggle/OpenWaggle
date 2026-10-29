import type { ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MultilingualE5SessionEmbeddingModel } from '../multilingual-e5-session-embedding-model'
import { SessionEmbeddingProcess, spawnEmbeddingChild } from '../session-embedding-process'
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

interface RecordedEmbeddingProcess {
  readonly embedding: SessionEmbeddingProcess
  readonly children: ChildProcess[]
  readonly exits: { code: number | null; signal: NodeJS.Signals | null }[]
}

/** The real embedding child, with its process handle and how it ended recorded. */
function recordedEmbeddingProcess(
  transformersPath: string,
  idleExitMs?: number,
): RecordedEmbeddingProcess {
  const children: ChildProcess[] = []
  const exits: RecordedEmbeddingProcess['exits'] = []
  const embedding = new SessionEmbeddingProcess(
    () => ({ modelId: 'model', revision: 'main', dtype: 'q8' }),
    {
      transformersPath,
      ...(idleExitMs === undefined ? {} : { idleExitMs }),
      spawnChild: (config) => {
        const child = spawnEmbeddingChild(config)
        children.push(child)
        child.on('exit', (code, signal) => exits.push({ code, signal }))
        return child
      },
    },
  )
  return { embedding, children, exits }
}

/**
 * The child ended by its own SIGKILL: a normal exit would run onnxruntime-node's static `Ort::Env`
 * destructor, which aborts. The parent never signalled it, so its grace kill did not do this.
 */
function expectKilledItself({ children, exits }: RecordedEmbeddingProcess) {
  expect(children.map((child) => child.killed)).toEqual([false])
  // Windows has no signals: libuv's SIGKILL is `TerminateProcess(handle, 1)`.
  if (process.platform === 'win32') expect(exits).toEqual([{ code: 1, signal: null }])
  else expect(exits).toEqual([{ code: null, signal: 'SIGKILL' }])
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

  it('ends an idle child with SIGKILL so onnxruntime exit teardown cannot abort it', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'ow-embedding-'))
    directories.push(directory)
    const recorded = recordedEmbeddingProcess(fakeTransformers(directory).file, 100)

    await recorded.embedding.embed(['a'])
    // Well inside `stop()`'s 5 s grace kill, so only the child's own kill can pass.
    await waitUntil(() => recorded.exits.length === 1, 2_000)
    expectKilledItself(recorded)
  })

  it.each([
    ['throws while it loads', "throw new Error('no onnxruntime here')", 'no onnxruntime here'],
    ['leaves a rejection unhandled', "Promise.reject(new Error('rejected load'))", 'rejected load'],
    ['throws a value that cannot be printed', 'throw Object.create(null)', 'unprintable error'],
  ])('fails a pending embedding and kills a child that %s', async (_case, source, message) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'ow-embedding-'))
    directories.push(directory)
    const broken = path.join(directory, 'broken.cjs')
    writeFileSync(broken, source)
    const recorded = recordedEmbeddingProcess(broken)

    await expect(recorded.embedding.embed(['a'])).rejects.toThrow(message)
    expectKilledItself(recorded)
  })

  it('embeds at most eight passages per inference call', () => {
    expect(EMBEDDING_INFERENCE_BATCH_SIZE).toBeLessThanOrEqual(8)
    expect(TRANSCRIPT_EMBEDDING_INFERENCE_BATCH_SIZE).toBeLessThanOrEqual(8)
  })
})
