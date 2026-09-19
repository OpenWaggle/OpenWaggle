import { describe, expect, it } from 'vitest'
import {
  SESSION_EMBEDDING_MODEL,
  SESSION_EMBEDDING_MODEL_FILES,
  SESSION_EMBEDDING_MODEL_RESOURCE_DIRECTORY,
} from '../multilingual-e5-session-embedding-model'

describe('multilingual E5 Session embedding model manifest', () => {
  it('pins the model revision, quantization, and vector contract', () => {
    expect(SESSION_EMBEDDING_MODEL).toEqual({
      id: 'Xenova/multilingual-e5-small',
      revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
      dimensions: 384,
      dtype: 'q8',
    })
  })

  it('pins every file copied into the packaged offline model bundle', () => {
    expect(SESSION_EMBEDDING_MODEL_RESOURCE_DIRECTORY).toBe('session-embedding-model')
    expect(SESSION_EMBEDDING_MODEL_FILES).toEqual([
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
    ])
  })
})
