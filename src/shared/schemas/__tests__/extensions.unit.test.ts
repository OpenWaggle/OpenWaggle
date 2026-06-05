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

  it('accepts optional project and session targets on contributions', () => {
    const result = safeDecodeUnknown(openWaggleExtensionManifestSchema, {
      ...validManifest,
      contributions: {
        commands: [
          {
            id: 'sample.targeted-command',
            title: 'Run Targeted Command',
            target: {
              projectPaths: ['/tmp/project'],
              sessionIds: ['session-1'],
            },
          },
        ],
        sidePanels: [
          {
            id: 'sample.targeted-panel',
            title: 'Targeted Panel',
            runtime: 'federated-module',
            execution: 'frame',
            entry: 'dist/panel.js',
            target: {
              projectPaths: ['/tmp/project'],
            },
          },
        ],
      },
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.contributions?.commands?.[0]?.target).toEqual({
        projectPaths: ['/tmp/project'],
        sessionIds: ['session-1'],
      })
    }
  })

  it('accepts exact https network origins', () => {
    const result = safeDecodeUnknown(openWaggleExtensionManifestSchema, {
      ...validManifest,
      network: {
        origins: ['https://api.github.com'],
      },
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.network?.origins).toEqual(['https://api.github.com'])
    }
  })

  it('rejects non-https network origins', () => {
    const result = safeDecodeUnknown(openWaggleExtensionManifestSchema, {
      ...validManifest,
      network: {
        origins: ['http://api.github.com'],
      },
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues.join('\n')).toContain('network.origins.0')
    }
  })

  it('rejects network origins with paths', () => {
    const result = safeDecodeUnknown(openWaggleExtensionManifestSchema, {
      ...validManifest,
      network: {
        origins: ['https://api.github.com/repos'],
      },
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues.join('\n')).toContain('network.origins.0')
    }
  })

  it('rejects obsolete lane-only UI contribution metadata', () => {
    const result = safeDecodeUnknown(openWaggleExtensionManifestSchema, {
      ...validManifest,
      contributions: {
        routes: [
          {
            id: 'sample.legacy',
            title: 'Legacy Route',
            lane: 'removed-renderer-lane',
            entry: 'dist/legacy.js',
          },
        ],
      },
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      const issues = result.issues.join('\n')
      expect(issues).toContain('runtime')
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

  it('accepts local-build install metadata', () => {
    const result = safeDecodeUnknown(openWaggleExtensionManifestSchema, {
      ...validManifest,
      install: { source: 'local-build' },
      build: {
        command: 'pnpm build',
        outputs: ['dist/index.js'],
      },
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.install?.source).toBe('local-build')
      expect(result.data.build?.command).toBe('pnpm build')
    }
  })

  it('rejects multiline build commands', () => {
    const result = safeDecodeUnknown(openWaggleExtensionManifestSchema, {
      ...validManifest,
      install: { source: 'local-build' },
      build: {
        command: 'pnpm build\npnpm test',
      },
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues.join('\n')).toContain('single command line')
    }
  })

  it('accepts external binary runtime requirements', () => {
    const result = safeDecodeUnknown(openWaggleExtensionManifestSchema, {
      ...validManifest,
      runtimeRequirements: [
        {
          id: 'sample.ripgrep',
          label: 'Ripgrep',
          binary: 'rg',
        },
      ],
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.runtimeRequirements?.[0]?.binary).toBe('rg')
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
})
