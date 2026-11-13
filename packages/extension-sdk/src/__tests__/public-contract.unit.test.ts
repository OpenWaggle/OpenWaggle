import * as Schema from 'effect/Schema'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { openWaggleAgentLoopSurfaceInputSchema } from '../agent-loop'
import * as brokerEntry from '../broker'
import { extensionModelPreferencesSettingsPatchSchema } from '../broker-schemas-openwaggle'
import { extensionInvokeInputSchema } from '../broker-schemas-core'
import { OPENWAGGLE_EXTENSION_BROKER } from '../constants'
import { extensionDocsDiscoverPayloadSchema } from '../docs'
import {
  defineExtensionManifest,
  openWaggleExtensionManifestSchema,
  validateExtensionManifest,
} from '../manifest'
import { extensionContributionRegistrationSchema } from '../runtime'
import type {
  ExtensionModelPreferencesSettingsPatch,
  ExtensionModelPrefs,
  ExtensionSelectedStateReadResult,
  ExtensionStateModelPreferencesReadResult,
} from '../types'

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
    sessionSummarySections: [
      {
        id: 'schema-smoke.session-summary',
        title: 'Schema smoke session summary',
        placement: 'details',
        disclosure: {
          defaultExpanded: true,
          collapsible: true,
          autoCollapseAfterMs: 30_000,
        },
        state: { status: 'live', message: 'Watching the current Session' },
        rows: [
          {
            id: 'status',
            label: 'Status',
            value: 'Ready',
            action: { family: 'commands', contributionId: 'schema-smoke.command' },
          },
        ],
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

  it('rejects Session Summary rows with both resource and action targets', () => {
    const contribution = {
      ...validManifest.contributions.sessionSummarySections[0],
      rows: [
        {
          id: 'ambiguous-target',
          label: 'Ambiguous target',
          resourceId: 'preview',
          action: { family: 'commands', contributionId: 'schema-smoke.command' },
        },
      ],
    } as const
    const validation = validateExtensionManifest({
      ...validManifest,
      contributions: {
        ...validManifest.contributions,
        sessionSummarySections: [contribution],
      },
    })

    expect(validation).toMatchObject({ success: false })
    if (!validation.success) {
      expect(validation.issues.join('\n')).toContain(
        'Session Summary rows cannot declare both resourceId and action.',
      )
    }
    expect(() =>
      Schema.decodeUnknownSync(extensionContributionRegistrationSchema)({
        family: 'sessionSummarySections',
        contribution,
      }),
    ).toThrow(/Session Summary rows cannot declare both resourceId and action/)
  })

  it('exports direct schemas for broker, docs, runtime, and agent-loop boundaries', () => {
    expect(OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RESOURCES).toBe('openwaggle.resources')
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
        family: 'sessionSummarySections',
        contribution: validManifest.contributions.sessionSummarySections[0],
      }),
    ).not.toThrow()
    expect(() =>
      Schema.decodeUnknownSync(openWaggleAgentLoopSurfaceInputSchema)({
        surface: 'status',
        status: { label: 'Ready' },
      }),
    ).not.toThrow()
  })

  // The 0.2 contract, which a minor release keeps: the broker entry point's schemas, an undecoded
  // success value, a string thinking level in a settings patch and readonly model lists.
  it('keeps the published 0.2 broker contract', () => {
    expect(Object.keys(brokerEntry)).toEqual(
      expect.arrayContaining([
        'extensionCapabilityAuditEntrySchema',
        'extensionInvokeErrorSchema',
        'extensionInvokeFailureSchema',
        'extensionInvokeInputSchema',
        'extensionInvokeResultSchema',
        'extensionInvokeScopeSchema',
        'extensionInvokeSuccessSchema',
      ]),
    )
    const success = {
      ok: true,
      value: { anything: 'an extension decodes itself' },
      audit: {
        extensionId: 'schema-smoke',
        contributionId: 'schema-smoke.settings',
        capability: 'openwaggle.storage',
        method: 'get',
        scope: { kind: 'app' },
        outcome: 'succeeded',
        timestamp: 1,
      },
    }
    expect(Schema.decodeUnknownSync(brokerEntry.extensionInvokeResultSchema)(success)).toEqual(
      success,
    )
    expect(
      Schema.decodeUnknownSync(extensionModelPreferencesSettingsPatchSchema)({
        thinkingLevel: 'a level a later Pi adds',
      }),
    ).toEqual({ thinkingLevel: 'a level a later Pi adds' })
    expectTypeOf<readonly string[]>().toExtend<
      NonNullable<ExtensionModelPreferencesSettingsPatch['favoriteModels']>
    >()
    expectTypeOf<ExtensionStateModelPreferencesReadResult>().toExtend<
      ExtensionSelectedStateReadResult<ExtensionModelPrefs>
    >()
  })
})
