import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { safeDecodeUnknown } from '@shared/schema'
import {
  extensionContributionRegistrationSchema,
  openWaggleExtensionManifestSchema,
} from '@shared/schemas/extensions'
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

describe('extension contribution registration schemas', () => {
  it('accepts broker method bindings on UI contributions', () => {
    const result = safeDecodeUnknown(openWaggleExtensionManifestSchema, {
      ...validManifest,
      capabilities: [
        {
          id: 'openwaggle.storage',
          methods: ['get', 'set', 'delete', 'list'],
          scopes: ['project'],
        },
      ],
      contributions: {
        routes: [
          {
            id: 'sample.settings',
            title: 'Sample Settings',
            runtime: 'federated-module',
            execution: 'host-renderer',
            entry: 'dist/settings.js',
            capability: 'openwaggle.storage',
            methods: ['get', 'set', 'delete', 'list'],
          },
        ],
      },
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.contributions?.routes?.[0]?.methods).toEqual([
        'get',
        'set',
        'delete',
        'list',
      ])
    }
  })

  it('rejects unsupported methods on built-in broker capability declarations', () => {
    const result = safeDecodeUnknown(openWaggleExtensionManifestSchema, {
      ...validManifest,
      capabilities: [
        {
          id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
          methods: ['delete-all-settings'],
          scopes: ['app'],
        },
      ],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues.join('\n')).toContain('does not support method "delete-all-settings"')
    }
  })

  it('keeps extension-owned custom capability methods extensible', () => {
    const result = safeDecodeUnknown(openWaggleExtensionManifestSchema, {
      ...validManifest,
      capabilities: [
        {
          id: 'sample.custom',
          methods: ['delete-all-settings'],
          scopes: ['project'],
        },
      ],
    })

    expect(result.success).toBe(true)
  })

  it('accepts a dynamic registration envelope for manifest contribution families', () => {
    const result = safeDecodeUnknown(extensionContributionRegistrationSchema, {
      family: 'toolRenderers',
      contribution: {
        id: 'sample.tool',
        title: 'Sample Tool',
        runtime: 'federated-module',
        execution: 'host-renderer',
        entry: 'dist/tool.js',
      },
    })

    expect(result.success).toBe(true)
  })

  it('rejects dynamic registration envelopes whose contribution shape does not match the family kind', () => {
    const result = safeDecodeUnknown(extensionContributionRegistrationSchema, {
      family: 'toolRenderers',
      contribution: {
        id: 'sample.tool',
        title: 'Sample Tool',
      },
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues.join('\n')).toContain('contribution.runtime')
    }
  })
})
