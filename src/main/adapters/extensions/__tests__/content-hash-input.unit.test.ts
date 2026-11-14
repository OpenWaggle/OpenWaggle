import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { getManifestContentHashInput } from '../content-hash-input'

describe('getManifestContentHashInput', () => {
  it('includes agent-loop renderer contribution entries in runtime file hashing', () => {
    expect(
      getManifestContentHashInput({
        builtArtifacts: ['dist/index.js'],
        contributions: {
          toolRenderers: [fromPartial({ entry: 'dist/tool.js' })],
          customMessageRenderers: [fromPartial({ entry: 'dist/custom-message.js' })],
          interactionRenderers: [fromPartial({ entry: 'dist/interaction.js' })],
        },
      }),
    ).toEqual({
      builtArtifacts: ['dist/index.js'],
      runtimeFiles: ['dist/tool.js', 'dist/custom-message.js', 'dist/interaction.js'],
    })
  })
})
