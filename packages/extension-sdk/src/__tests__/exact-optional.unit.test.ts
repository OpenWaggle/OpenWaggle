import { describe, expect, it } from 'vitest'
import { validateExtensionManifest } from '../manifest'

const MANIFEST = {
  manifestVersion: 1,
  id: 'sample-extension',
  name: 'Sample',
  version: '0.1.0',
  sdk: { openwaggle: '0.1.0' },
  sourceFiles: [],
  builtArtifacts: [],
}

describe('exact optional manifest fields', () => {
  // A missing key and a key set to undefined differ: the manifest's optional fields are exact.
  it('refuses an optional field set to undefined, naming the field', () => {
    expect(validateExtensionManifest({ ...MANIFEST, description: undefined })).toEqual({
      success: false,
      issues: ['description: Expected string, actual undefined'],
    })
  })

  it('accepts the same manifest with the field left out', () => {
    expect(validateExtensionManifest(MANIFEST)).toMatchObject({ success: true })
  })
})
