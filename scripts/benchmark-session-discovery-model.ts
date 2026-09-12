import type { SessionEmbeddingModel } from '../src/main/adapters/multilingual-e5-session-embedding-model'

const BENCHMARK_MODEL_DIMENSIONS = 3

export const benchmarkSessionDiscoveryModel: SessionEmbeddingModel = {
  metadata: {
    id: 'benchmark/embedding',
    revision: 'benchmark-1',
    dimensions: BENCHMARK_MODEL_DIMENSIONS,
    dtype: 'f32',
  },
  embedQueries: async (texts) => texts.map(() => new Float32Array([1, 0, 0])),
  embedPassages: async (texts) => texts.map(() => new Float32Array([1, 0, 0])),
}
