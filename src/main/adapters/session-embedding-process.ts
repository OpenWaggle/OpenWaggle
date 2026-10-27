/**
 * Session embedding inference in a child process (D3). Loading multilingual-e5 with onnxruntime
 * takes ~0.6–1 GB, which a Node process does not give back after `dispose()` or a worker thread's
 * exit, and one batch blocked the Host's event loop for up to ~280 ms. The child runs the model
 * off the Host's main thread and exits after `SESSION_EMBEDDING_IDLE_EXIT_MS` without work, so its
 * memory is returned whole; the next embedding pays the model load again (~0.4–1.2 s).
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { Schema, safeDecodeUnknown } from '@shared/schema'
import { getSafeChildEnv } from '../env'

export const SESSION_EMBEDDING_IDLE_EXIT_MS = 60_000
const STDERR_TAIL_CHARS = 2_000
/** How long a disconnected child may finish a batch before it is killed. */
const STOP_GRACE_MS = 5_000

export interface SessionEmbeddingProcessConfig {
  readonly modelId: string
  readonly revision: string
  readonly dtype: string
  readonly localModelPath?: string
  readonly allowRemoteModels?: boolean
}

/*
 * One request at a time, in order. ONNX threads are capped so a batch does not take every core.
 * The parent's `disconnect` (or its exit) ends the child.
 */
const EMBEDDING_PROCESS_SOURCE = `
const config = JSON.parse(process.argv[process.argv.length - 1])
const transformers = require(config.transformersPath)
let extractor
function load() {
  if (config.localModelPath !== undefined) transformers.env.localModelPath = config.localModelPath
  if (config.allowRemoteModels !== undefined) transformers.env.allowRemoteModels = config.allowRemoteModels
  extractor ??= transformers.pipeline('feature-extraction', config.modelId, {
    revision: config.revision,
    dtype: config.dtype,
    session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
  })
  return extractor
}
let queue = Promise.resolve()
process.on('message', (message) => {
  if (!message || message.type !== 'embed') return
  queue = queue.then(async () => {
    try {
      const output = await (await load())(message.texts, { pooling: 'mean', normalize: true })
      const data = Float32Array.from(output.data)
      const dims = Array.from(output.dims)
      output.dispose()
      process.send({ type: 'result', id: message.id, dims, data })
    } catch (error) {
      process.send({ type: 'error', id: message.id, error: String((error && error.message) || error) })
    }
  })
})
process.on('disconnect', () => process.exit(0))
`

const EmbeddingProcessMessage = Schema.Union(
  Schema.Struct({
    type: Schema.Literal('result'),
    id: Schema.Number,
    dims: Schema.Array(Schema.Number),
    data: Schema.instanceOf(Float32Array),
  }),
  Schema.Struct({ type: Schema.Literal('error'), id: Schema.Number, error: Schema.String }),
)

export interface EmbeddingTensor {
  readonly dims: readonly number[]
  readonly data: Float32Array
}

interface PendingEmbedding {
  readonly resolve: (tensor: EmbeddingTensor) => void
  readonly reject: (error: Error) => void
}

export type EmbeddingChildFactory = (config: string) => ChildProcess

const spawnEmbeddingChild: EmbeddingChildFactory = (config) =>
  spawn(process.execPath, ['-e', EMBEDDING_PROCESS_SOURCE, config], {
    // Electron's binary runs as Node; the child needs no secrets.
    env: { ...getSafeChildEnv(), ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    serialization: 'advanced',
    windowsHide: true,
  })

export interface SessionEmbeddingProcessOptions {
  readonly spawnChild?: EmbeddingChildFactory
  readonly idleExitMs?: number
  /** Where the child loads transformers.js from; defaults to the Host's own copy. */
  readonly transformersPath?: string
}

export class SessionEmbeddingProcess {
  private child: ChildProcess | undefined
  private readonly pending = new Map<number, PendingEmbedding>()
  private nextId = 1
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  private stderrTail = ''
  private readonly idleExitMs: number
  private readonly spawnChild: EmbeddingChildFactory

  constructor(
    private readonly config: () => SessionEmbeddingProcessConfig,
    private readonly options: SessionEmbeddingProcessOptions = {},
  ) {
    this.idleExitMs = options.idleExitMs ?? SESSION_EMBEDDING_IDLE_EXIT_MS
    this.spawnChild = options.spawnChild ?? spawnEmbeddingChild
  }

  /** Whether the model process is running now. */
  get isRunning() {
    return this.child !== undefined
  }

  embed(texts: readonly string[]): Promise<EmbeddingTensor> {
    this.cancelIdleExit()
    const child = this.child ?? this.start()
    const id = this.nextId++
    return new Promise<EmbeddingTensor>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      child.send({ type: 'embed', id, texts: [...texts] }, (error) => {
        if (error) this.settle(id, { error: error.message })
      })
    })
  }

  /** Ends the model process now unless it is working; returns whether it ended. */
  dispose() {
    if (this.pending.size > 0) return false
    this.stop()
    return true
  }

  private start() {
    const transformersPath =
      this.options.transformersPath ??
      createRequire(__filename).resolve('@huggingface/transformers')
    const child = this.spawnChild(JSON.stringify({ ...this.config(), transformersPath }))
    this.child = child
    this.stderrTail = ''
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-STDERR_TAIL_CHARS)
    })
    child.on('message', (message: unknown) => this.receive(message))
    child.on('error', (error) => this.childEnded(child, error.message))
    child.on('exit', (code, signal) =>
      this.childEnded(child, `The embedding process exited (${String(signal ?? code)}).`),
    )
    return child
  }

  private receive(message: unknown) {
    const decoded = safeDecodeUnknown(EmbeddingProcessMessage, message)
    if (!decoded.success) return
    const value = decoded.data
    if (value.type === 'error') this.settle(value.id, { error: value.error })
    else this.settle(value.id, { tensor: { dims: value.dims, data: value.data } })
  }

  private settle(
    id: number,
    outcome: { readonly tensor: EmbeddingTensor } | { readonly error: string },
  ) {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    if ('tensor' in outcome) pending.resolve(outcome.tensor)
    else pending.reject(new Error(outcome.error))
    if (this.pending.size === 0) this.scheduleIdleExit()
  }

  private childEnded(child: ChildProcess, reason: string) {
    if (this.child !== child) return
    this.child = undefined
    this.cancelIdleExit()
    const stderr = this.stderrTail.trim()
    const message = stderr ? `${reason}\n${stderr}` : reason
    for (const id of [...this.pending.keys()]) this.settle(id, { error: message })
  }

  private scheduleIdleExit() {
    this.cancelIdleExit()
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined
      this.dispose()
    }, this.idleExitMs)
    this.idleTimer.unref()
  }

  private cancelIdleExit() {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = undefined
  }

  private stop() {
    this.cancelIdleExit()
    const child = this.child
    if (!child) return
    this.child = undefined
    if (child.connected) child.disconnect()
    // A child stuck in inference ignores the disconnect until it finishes; it may not linger.
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }, STOP_GRACE_MS).unref()
  }
}
