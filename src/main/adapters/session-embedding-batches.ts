import type { SessionEmbeddingModel } from './multilingual-e5-session-embedding-model'

export async function embedPassagesInBatches(
  model: SessionEmbeddingModel,
  documents: readonly string[],
  batchSize: number,
) {
  const vectors: Float32Array[] = []
  for (let offset = 0; offset < documents.length; offset += batchSize) {
    vectors.push(...(await model.embedPassages(documents.slice(offset, offset + batchSize))))
  }
  return vectors
}
