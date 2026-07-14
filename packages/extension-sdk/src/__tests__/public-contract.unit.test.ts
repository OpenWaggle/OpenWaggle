import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'
import { openWaggleAgentLoopSurfaceInputSchema } from '../agent-loop'
import { extensionInvokeInputSchema } from '../broker'
import { extensionDocsDiscoverPayloadSchema } from '../docs'
import {
  defineExtensionManifest,
  openWaggleExtensionManifestSchema,
  validateExtensionManifest,
} from '../manifest'
import { extensionContributionRegistrationSchema } from '../runtime'

const validManifest = {
  manifestVersion: 1,
  id: 'schema-smoke',
  name: 'Schema smoke',
  version: '0.1.0',
  sdk: { openwaggle: '0.1.0' },
  sourceFiles: [],
  builtArtifacts: ['dist/settings.js'],
  capabilities: [
    {
      id: 'openwaggle.storage',
      methods: ['get', 'set'],
      scopes: ['project'],
    },
  ],
  contributions: {
    settingsSections: [
      {
        id: 'schema-smoke.settings',
        title: 'Schema smoke settings',
        runtime: 'federated-module',
        execution: 'host-renderer',
        entry: 'dist/settings.js',
        capability: 'openwaggle.storage',
        methods: ['get', 'set'],
      },
    ],
  },
} as const

describe('extension SDK public schemas', () => {
  it('defines and validates host-compatible manifests', () => {
    const manifest = defineExtensionManifest(validManifest)

    expect(Schema.decodeUnknownSync(openWaggleExtensionManifestSchema)(manifest)).toEqual(manifest)
    expect(validateExtensionManifest(manifest)).toEqual({ success: true, manifest })
    expect(
      validateExtensionManifest({
        ...validManifest,
        contributions: {
          settingsSections: [
            {
              id: 'schema-smoke.settings',
              title: 'Schema smoke settings',
              runtime: 'federated-module',
              entry: 'dist/settings.js',
            },
          ],
        },
      }),
    ).toMatchObject({ success: false })
  })

  it('exports direct schemas for broker, docs, runtime, and agent-loop boundaries', () => {
    expect(() =>
      Schema.decodeUnknownSync(extensionInvokeInputSchema)({
        extensionId: 'schema-smoke',
        contributionId: 'schema-smoke.settings',
        capability: 'openwaggle.storage',
        method: 'get',
        scope: { kind: 'project', projectPath: '/tmp/project' },
      }),
    ).not.toThrow()
    expect(() => Schema.decodeUnknownSync(extensionDocsDiscoverPayloadSchema)({})).not.toThrow()
    expect(() =>
      Schema.decodeUnknownSync(extensionContributionRegistrationSchema)({
        family: 'settingsSections',
        contribution: validManifest.contributions.settingsSections[0],
      }),
    ).not.toThrow()
    expect(() =>
      Schema.decodeUnknownSync(openWaggleAgentLoopSurfaceInputSchema)({
        surface: 'status',
        status: { label: 'Ready' },
      }),
    ).not.toThrow()
  })
})
