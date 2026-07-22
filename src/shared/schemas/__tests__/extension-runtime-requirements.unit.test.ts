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
}

describe('openWaggleExtensionManifestSchema runtime requirements', () => {
  it('accepts external binary runtime requirements', () => {
    const result = safeDecodeUnknown(openWaggleExtensionManifestSchema, {
      ...validManifest,
      runtimeRequirements: [
        {
          kind: 'binary',
          id: 'sample.ripgrep',
          label: 'Ripgrep',
          binary: 'rg',
        },
      ],
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.runtimeRequirements?.[0]?.kind).toBe('binary')
      expect(result.data.runtimeRequirements?.[0]?.binary).toBe('rg')
    }
  })

  it('accepts package command runtime requirements', () => {
    const result = safeDecodeUnknown(openWaggleExtensionManifestSchema, {
      ...validManifest,
      runtimeRequirements: [
        {
          kind: 'command',
          id: 'sample.provider',
          label: 'Sample provider module',
          command: 'extensions/provider.js',
        },
      ],
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.runtimeRequirements?.[0]?.command).toBe('extensions/provider.js')
    }
  })

  it('rejects runtime requirement binary paths', () => {
    const result = safeDecodeUnknown(openWaggleExtensionManifestSchema, {
      ...validManifest,
      runtimeRequirements: [
        {
          id: 'sample.ripgrep',
          label: 'Ripgrep',
          binary: '/usr/bin/rg',
        },
      ],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues.join('\n')).toContain('executable name')
    }
  })

  it('rejects runtime requirements without a binary or command target', () => {
    const result = safeDecodeUnknown(openWaggleExtensionManifestSchema, {
      ...validManifest,
      runtimeRequirements: [
        {
          id: 'sample.empty',
          label: 'Empty requirement',
        },
      ],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues.join('\n')).toContain('exactly one runtime requirement target')
    }
  })

  it('rejects runtime requirements with mismatched explicit kinds', () => {
    const result = safeDecodeUnknown(openWaggleExtensionManifestSchema, {
      ...validManifest,
      runtimeRequirements: [
        {
          kind: 'binary',
          id: 'sample.provider',
          label: 'Provider module',
          command: 'extensions/provider.js',
        },
      ],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues.join('\n')).toContain('kind must be "command"')
    }
  })
})
