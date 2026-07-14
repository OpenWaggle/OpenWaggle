import { describe, expect, it } from 'vitest'
import { getManifestContentHashInput } from '../content-hash-input'

describe('getManifestContentHashInput', () => {
  it('includes agent-loop renderer contribution entries in runtime file hashing', () => {
    expect(
      getManifestContentHashInput({
        builtArtifacts: ['dist/index.js'],
        contributions: {
          toolRenderers: [{ entry: 'dist/tool.js' }],
          customMessageRenderers: [{ entry: 'dist/custom-message.js' }],
          interactionRenderers: [{ entry: 'dist/interaction.js' }],
        },
      }),
    ).toEqual({
      builtArtifacts: ['dist/index.js'],
      runtimeFiles: ['dist/tool.js', 'dist/custom-message.js', 'dist/interaction.js'],
    })
  })
})
