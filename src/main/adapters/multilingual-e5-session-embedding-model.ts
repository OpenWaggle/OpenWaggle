import { type EmbeddingTensor, SessionEmbeddingProcess } from './session-embedding-process'

export const SESSION_EMBEDDING_MODEL = {
  id: 'Xenova/multilingual-e5-small',
  revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
  dimensions: 384,
  dtype: 'q8',
} as const

export const SESSION_EMBEDDING_MODEL_RESOURCE_DIRECTORY = 'session-embedding-model'

export const SESSION_EMBEDDING_MODEL_FILES = [
  {
    path: 'config.json',
    sha256: 'cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1',
  },
  {
    path: 'tokenizer_config.json',
    sha256: 'a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b',
  },
  {
    path: 'tokenizer.json',
    sha256: '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39',
  },
  {
    path: 'onnx/model_quantized.onnx',
    sha256: 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193',
  },
] as const

interface SessionEmbeddingRuntimeOptions {
  readonly localModelPath?: string
  readonly allowRemoteModels?: boolean
}

export interface SessionEmbeddingModel {
  readonly metadata: {
    readonly id: string
    readonly revision: string
    readonly dimensions: number
    readonly dtype: string
  }
  readonly embedQueries: (texts: readonly string[]) => Promise<readonly Float32Array[]>
  readonly embedPassages: (texts: readonly string[]) => Promise<readonly Float32Array[]>
}

function vectorsFromTensor(output: EmbeddingTensor, expectedCount: number) {
  const dimensions = output.dims.at(-1)
  if (dimensions !== SESSION_EMBEDDING_MODEL.dimensions) {
    throw new Error(`Embedding model returned ${String(dimensions)} dimensions.`)
  }
  if (output.data.length !== expectedCount * dimensions) {
    throw new Error('Embedding model returned an unexpected batch shape.')
  }
  const vectors: Float32Array[] = []
  for (let batch = 0; batch < expectedCount; batch += 1) {
    vectors.push(output.data.slice(batch * dimensions, (batch + 1) * dimensions))
  }
  return vectors
}

/**
 * multilingual-e5 for Session discovery. Inference runs in a child process that exits after a
 * minute without work and on `dispose()` (idle-slim Host), so the Host never holds the model (D3).
 */
export class MultilingualE5SessionEmbeddingModel implements SessionEmbeddingModel {
  readonly metadata = SESSION_EMBEDDING_MODEL
  #runtimeOptions: SessionEmbeddingRuntimeOptions = {}
  #used = false
  readonly #process: SessionEmbeddingProcess

  constructor(options: ConstructorParameters<typeof SessionEmbeddingProcess>[1] = {}) {
    this.#process = new SessionEmbeddingProcess(
      () => ({
        modelId: SESSION_EMBEDDING_MODEL.id,
        revision: SESSION_EMBEDDING_MODEL.revision,
        dtype: SESSION_EMBEDDING_MODEL.dtype,
        ...this.#runtimeOptions,
      }),
      options,
    )
  }

  configureRuntime(options: SessionEmbeddingRuntimeOptions) {
    if (this.#used) {
      throw new Error('Session embedding runtime must be configured before its first use.')
    }
    this.#runtimeOptions = options
  }

  embedQueries(texts: readonly string[]) {
    return this.#embed(texts.map((text) => `query: ${text}`))
  }

  embedPassages(texts: readonly string[]) {
    return this.#embed(texts.map((text) => `passage: ${text}`))
  }

  /** Ends the model process unless it is embedding; the next embedding starts it again. */
  dispose() {
    return this.#process.dispose()
  }

  get isLoaded() {
    return this.#process.isRunning
  }

  async #embed(texts: readonly string[]) {
    if (texts.length === 0) return []
    this.#used = true
    return vectorsFromTensor(await this.#process.embed(texts), texts.length)
  }
}

export const defaultSessionEmbeddingModel = new MultilingualE5SessionEmbeddingModel()

export function configureDefaultSessionEmbeddingModelForPackagedRuntime(localModelPath: string) {
  defaultSessionEmbeddingModel.configureRuntime({
    localModelPath,
    allowRemoteModels: false,
  })
}
