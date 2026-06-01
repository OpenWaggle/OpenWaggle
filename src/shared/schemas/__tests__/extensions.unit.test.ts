import { safeDecodeUnknown } from '@shared/schema'
import { openWaggleExtensionManifestSchema } from '@shared/schemas/extensions'
import { describe, expect, it } from 'vitest'

const validManifest = {
  manifestVersion: 1,
  id: 'sample-extension',
  name: 'Sample Extension',
  version: '1.0.0',
  sdk: {
    openwaggle: '>=0.1.0 <0.2.0',
  },
  sourceFiles: ['src/index.ts'],
  builtArtifacts: ['dist/index.js'],
  contributions: {
    commands: [
      {
        id: 'sample.run',
        title: 'Run Sample',
        capability: 'sample.invoke',
      },
    ],
  },
}

describe('openWaggleExtensionManifestSchema', () => {
  it('accepts a valid v1 extension manifest', () => {
    const result = safeDecodeUnknown(openWaggleExtensionManifestSchema, validManifest)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.id).toBe('sample-extension')
      expect(result.data.contributions?.commands?.[0]?.id).toBe('sample.run')
    }
  })

  it('rejects invalid package ids', () => {
    const result = safeDecodeUnknown(openWaggleExtensionManifestSchema, {
      ...validManifest,
      id: 'Sample Extension',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues.join('\n')).toContain('id')
    }
  })

  it('rejects unsafe relative paths', () => {
    const result = safeDecodeUnknown(openWaggleExtensionManifestSchema, {
      ...validManifest,
      sourceFiles: ['../src/index.ts'],
      builtArtifacts: ['/tmp/dist/index.js'],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues.join('\n')).toContain('sourceFiles.0')
    }
  })

  it('rejects relative paths with leading or trailing whitespace', () => {
    const result = safeDecodeUnknown(openWaggleExtensionManifestSchema, {
      ...validManifest,
      sourceFiles: [' src/index.ts'],
      builtArtifacts: ['dist/index.js '],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues.join('\n')).toContain('leading or trailing whitespace')
    }
  })
})
