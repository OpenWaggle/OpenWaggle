import {
  SessionEmbeddingModelFiles,
  type SessionEmbeddingModelAvailability,
} from './session-embedding-model-files'
import { type EmbeddingTensor, SessionEmbeddingProcess } from './session-embedding-process'

export const SESSION_EMBEDDING_MODEL = {
  id: 'Xenova/multilingual-e5-small',
  revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
  dimensions: 384,
  dtype: 'q8',
} as const

export const SESSION_EMBEDDING_MODEL_RESOURCE_DIRECTORY = 'session-embedding-model'

/** The pinned files of the revision; `bytes` gives download progress and the quick presence check. */
export const SESSION_EMBEDDING_MODEL_FILES = [
  {
    path: 'config.json',
    sha256: 'cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1',
    bytes: 658,
  },
  {
    path: 'tokenizer_config.json',
    sha256: 'a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b',
    bytes: 443,
  },
  {
    path: 'tokenizer.json',
    sha256: '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39',
    bytes: 17_082_730,
  },
  {
    path: 'onnx/model_quantized.onnx',
    sha256: 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193',
    bytes: 118_308_185,
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
  /**
   * Whether the model can embed now, without a download. A model fetched on first use is `missing`
   * (or downloading, offline, failed) until its files are on disk; searches stay lexical until then.
   * Absent: always available.
   */
  readonly availability?: () => Promise<SessionEmbeddingModelAvailability>
  /** Calls `listener` when the availability changes (download progress included). */
  readonly onAvailabilityChange?: (
    listener: (availability: SessionEmbeddingModelAvailability) => void,
  ) => () => void
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
  #files: SessionEmbeddingModelFiles | null = null
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

  /** Loads the model from `files`, which downloads it on first use (session-embedding-model-files.ts). */
  useModelFiles(files: SessionEmbeddingModelFiles) {
    if (this.#used) {
      throw new Error('Session embedding model files must be set before their first use.')
    }
    this.#files = files
  }

  readonly availability = async (): Promise<SessionEmbeddingModelAvailability> => {
    const files = this.#files
    if (files === null || this.#runtimeOptions.localModelPath !== undefined) {
      return { state: 'ready' }
    }
    await files.present()
    return files.availability()
  }

  readonly onAvailabilityChange = (
    listener: (availability: SessionEmbeddingModelAvailability) => void,
  ) => this.#files?.onChange(listener) ?? (() => undefined)

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
    if (this.#files !== null && this.#runtimeOptions.localModelPath === undefined) {
      const localModelPath = await this.#files.ensure()
      this.#runtimeOptions = { localModelPath, allowRemoteModels: false }
    }
    return vectorsFromTensor(await this.#process.embed(texts), texts.length)
  }
}

export const defaultSessionEmbeddingModel = new MultilingualE5SessionEmbeddingModel()

/**
 * The app's model: downloaded on first use into `downloadDirectory` (under userData, which updates
 * keep), or loaded from `bundledDirectory` when a build ships it.
 */
export function configureDefaultSessionEmbeddingModelFiles(input: {
  readonly downloadDirectory: () => string
  readonly bundledDirectory?: string
}) {
  defaultSessionEmbeddingModel.useModelFiles(
    new SessionEmbeddingModelFiles({
      modelId: SESSION_EMBEDDING_MODEL.id,
      revision: SESSION_EMBEDDING_MODEL.revision,
      files: SESSION_EMBEDDING_MODEL_FILES,
      ...input,
    }),
  )
}
