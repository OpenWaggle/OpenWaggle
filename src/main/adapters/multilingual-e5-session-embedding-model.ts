import type { FeatureExtractionPipeline } from '@huggingface/transformers'

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

function vectorsFromTensor(
  output: Awaited<ReturnType<FeatureExtractionPipeline>>,
  expectedCount: number,
) {
  const dimensions = output.dims.at(-1)
  if (dimensions !== SESSION_EMBEDDING_MODEL.dimensions) {
    throw new Error(`Embedding model returned ${String(dimensions)} dimensions.`)
  }
  if (output.size !== expectedCount * dimensions) {
    throw new Error('Embedding model returned an unexpected batch shape.')
  }
  const vectors: Float32Array[] = []
  for (let batch = 0; batch < expectedCount; batch += 1) {
    const vector = new Float32Array(dimensions)
    for (let index = 0; index < dimensions; index += 1) {
      vector[index] = Number(output.data[batch * dimensions + index] ?? 0)
    }
    vectors.push(vector)
  }
  output.dispose()
  return vectors
}

export class MultilingualE5SessionEmbeddingModel implements SessionEmbeddingModel {
  readonly metadata = SESSION_EMBEDDING_MODEL
  #pipeline: Promise<FeatureExtractionPipeline> | undefined
  #runtimeOptions: SessionEmbeddingRuntimeOptions = {}

  configureRuntime(options: SessionEmbeddingRuntimeOptions) {
    if (this.#pipeline !== undefined) {
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

  async #embed(texts: readonly string[]) {
    if (texts.length === 0) return []
    const extractor = await this.#extractor()
    const output = await extractor([...texts], { pooling: 'mean', normalize: true })
    return vectorsFromTensor(output, texts.length)
  }

  #extractor() {
    this.#pipeline ??= import('@huggingface/transformers').then(({ env, pipeline }) => {
      if (this.#runtimeOptions.localModelPath !== undefined) {
        env.localModelPath = this.#runtimeOptions.localModelPath
      }
      if (this.#runtimeOptions.allowRemoteModels !== undefined) {
        env.allowRemoteModels = this.#runtimeOptions.allowRemoteModels
      }
      return pipeline('feature-extraction', SESSION_EMBEDDING_MODEL.id, {
        revision: SESSION_EMBEDDING_MODEL.revision,
        dtype: SESSION_EMBEDDING_MODEL.dtype,
      })
    })
    return this.#pipeline
  }
}

export const defaultSessionEmbeddingModel = new MultilingualE5SessionEmbeddingModel()

export function configureDefaultSessionEmbeddingModelForPackagedRuntime(localModelPath: string) {
  defaultSessionEmbeddingModel.configureRuntime({
    localModelPath,
    allowRemoteModels: false,
  })
}
