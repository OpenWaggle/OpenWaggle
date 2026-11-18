import * as Schema from 'effect/Schema'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  extensionInvokeDeclaredSuccessSchema,
  extensionInvokeSuccessSchema,
} from '../internal/broker-schemas-result'
import { extensionInvokeResultSchema } from '../internal/broker-schemas-result'
import { extensionModelPreferencesSettingsPatchSchema } from '../internal/broker-schemas-openwaggle'
import { extensionContributionRegistrationSchema } from '../internal/manifest-contributions'
import type { SchemaType } from '../internal/schema'
import { defineExtensionManifest } from '../manifest'
import type {
  ExtensionInvokeResult,
  ExtensionInvokeSuccess,
  ExtensionInvokeSuccessValue,
  ExtensionModelPreferencesSettingsPatch,
  ExtensionModelPrefs,
  ExtensionSelectedStateReadResult,
  ExtensionStateModelPreferencesReadResult,
} from '../types'
import { validateBrokerCapabilityDeclaration, validateExtensionManifest } from '../validation'

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

describe('extension SDK validation helpers', () => {
  it('returns the valid manifest as the value', () => {
    const manifest = defineExtensionManifest(validManifest)

    expect(validateExtensionManifest(manifest)).toEqual({ success: true, value: manifest })
  })

  it('reports each issue at the field path the host reports, without throwing', () => {
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
    ).toEqual({
      success: false,
      issues: [{ path: 'contributions.settingsSections.0.execution', message: 'is missing' }],
    })
    expect(validateExtensionManifest(null)).toEqual({
      success: false,
      issues: [{ path: '(root)', message: 'Expected an object, actual null' }],
    })
  })

  it('says an object or an array is expected instead of printing its whole schema', () => {
    expect(
      validateExtensionManifest({
        ...validManifest,
        sdk: 3,
        sourceFiles: 'src/index.ts',
        contributions: { commands: [5] },
      }),
    ).toEqual({
      success: false,
      issues: [
        { path: 'sdk', message: 'Expected an object, actual 3' },
        { path: 'sourceFiles', message: 'Expected an array, actual "src/index.ts"' },
        { path: 'contributions.commands.0', message: 'Expected an object, actual 5' },
      ],
    })
  })

  it.each([
    [
      'a throwing getter',
      Object.defineProperty({ ...validManifest }, 'id', {
        enumerable: true,
        get: () => {
          throw new Error('id is unreadable')
        },
      }),
    ],
    [
      'a Proxy whose get throws',
      new Proxy(
        { ...validManifest },
        {
          get: () => {
            throw new Error('id is unreadable')
          },
        },
      ),
    ],
  ])('returns an issue instead of throwing for %s', (_case, manifest) => {
    expect(validateExtensionManifest(manifest)).toEqual({
      success: false,
      issues: [{ path: '', message: 'Could not read the value: id is unreadable' }],
    })
  })

  it('checks a built-in capability declares only methods the broker supports', () => {
    expect(
      validateBrokerCapabilityDeclaration({ id: 'openwaggle.storage', methods: ['get'] }),
    ).toEqual({ success: true, value: { id: 'openwaggle.storage', methods: ['get'] } })
    expect(
      validateBrokerCapabilityDeclaration({ id: 'openwaggle.storage', methods: ['launch'] }),
    ).toEqual({
      success: false,
      issues: [
        {
          path: '(root)',
          message:
            'Built-in broker capability "openwaggle.storage" does not support method "launch".',
        },
      ],
    })
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

    expect(validation).toEqual({
      success: false,
      issues: [
        {
          path: 'contributions.sessionSummarySections.0.rows.0',
          message: 'Session Summary rows cannot declare both resourceId and action.',
        },
      ],
    })
    expect(() =>
      Schema.decodeUnknownSync(extensionContributionRegistrationSchema)({
        family: 'sessionSummarySections',
        contribution,
      }),
    ).toThrow(/Session Summary rows cannot declare both resourceId and action/)
  })
})

// The public entries publish types and helpers, never schemas (ADR 0066).
describe.each([
  ['.', () => import('../index')],
  ['./agent-loop', () => import('../agent-loop')],
  ['./docs', () => import('../docs')],
  ['./json', () => import('../json')],
  ['./runtime', () => import('../runtime')],
  ['./testing', () => import('../testing')],
  ['./validation', () => import('../validation')],
])('the %s entry', (_entry, load) => {
  it('exports no schema', async () => {
    const exportNames = Object.keys(await load())
    expect(exportNames.filter((name) => name.endsWith('Schema'))).toEqual([])
  })
})

// The 0.2 broker types that 0.3 keeps: only the schemas leave the public API (ADR 0066).
describe('the 0.2 broker types', () => {
  it('keep an undecoded success value, a string thinking level and readonly model lists', () => {
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
    expect(Schema.decodeUnknownSync(extensionInvokeResultSchema)(success)).toEqual(success)
    expect(
      Schema.decodeUnknownSync(extensionModelPreferencesSettingsPatchSchema)({
        thinkingLevel: 'a level a later Pi adds',
      }),
    ).toEqual({ thinkingLevel: 'a level a later Pi adds' })
    expectTypeOf<ExtensionInvokeSuccess['value']>().toBeUnknown()
    expectTypeOf<string>().toExtend<NonNullable<ExtensionModelPrefs['thinkingLevel']>>()
    expectTypeOf<readonly string[]>().toExtend<
      NonNullable<ExtensionModelPreferencesSettingsPatch['favoriteModels']>
    >()
    expectTypeOf<ExtensionStateModelPreferencesReadResult>().toExtend<
      ExtensionSelectedStateReadResult<ExtensionModelPrefs>
    >()
  })
})

// `ExtensionInvokeSuccess` is hand-written, because its `value` is a type parameter a schema
// cannot carry, so these keep it equal to the schemas the broker client decodes with.
describe('the broker result types', () => {
  it('equal the schemas, with value as the type parameter', () => {
    expectTypeOf<ExtensionInvokeSuccess>().toEqualTypeOf<
      SchemaType<typeof extensionInvokeSuccessSchema>
    >()
    expectTypeOf<ExtensionInvokeResult>().toEqualTypeOf<
      SchemaType<typeof extensionInvokeResultSchema>
    >()
    expectTypeOf<
      Omit<ExtensionInvokeSuccess<ExtensionInvokeSuccessValue>, 'value'>
    >().toEqualTypeOf<Omit<SchemaType<typeof extensionInvokeDeclaredSuccessSchema>, 'value'>>()
    expectTypeOf<ExtensionInvokeSuccess<ExtensionInvokeSuccessValue>['value']>().toEqualTypeOf<
      SchemaType<typeof extensionInvokeDeclaredSuccessSchema>['value']
    >()
  })
})
