import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { Schema } from '@shared/schema'
import {
  extensionRuntimeRegisterContributionPayloadSchema,
  extensionSessionResourcesListPayloadSchema,
  extensionSettingsUpdatePayloadSchema,
  extensionSettingsUpdateSettingPayloadSchema,
} from '@shared/schemas/extension-broker'
import { extensionDocsDiscoverPayloadSchema } from '@shared/schemas/extension-broker-docs'
import * as Either from 'effect/Either'
import { describe, expect, it } from 'vitest'
import { normalizeInput } from '../extension-capability-broker-model'

// postMessage and Electron IPC keep a key whose value is undefined, and the exact optional payload
// schemas refuse it, so the broker drops such keys before it decodes a payload.
const PAYLOADS = [
  {
    kind: 'resources.list cursor and limit',
    decode: Schema.decodeUnknownEither(extensionSessionResourcesListPayloadSchema),
    payload: { cursor: undefined, limit: undefined },
    expected: {},
  },
  {
    kind: 'docs.discover',
    decode: Schema.decodeUnknownEither(extensionDocsDiscoverPayloadSchema),
    payload: { projectPaths: undefined, includeExtensions: true },
    expected: { includeExtensions: true },
  },
  {
    kind: 'settings.update',
    decode: Schema.decodeUnknownEither(extensionSettingsUpdatePayloadSchema),
    payload: { selectedModel: undefined, favoriteModels: ['openai/gpt-5.5'] },
    expected: { favoriteModels: ['openai/gpt-5.5'] },
  },
  {
    kind: 'settings.updateModelPreferences',
    decode: Schema.decodeUnknownEither(extensionSettingsUpdateSettingPayloadSchema),
    payload: {
      key: OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.MODEL_PREFERENCES,
      value: {
        selectedModel: 'openai/gpt-5.5',
        enabledModels: undefined,
        thinkingLevel: undefined,
      },
    },
    expected: {
      key: OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.MODEL_PREFERENCES,
      value: { selectedModel: 'openai/gpt-5.5' },
    },
  },
  {
    kind: 'runtime.registerContribution',
    decode: Schema.decodeUnknownEither(extensionRuntimeRegisterContributionPayloadSchema),
    payload: {
      family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.COMMANDS,
      contribution: {
        id: 'sample.run',
        title: 'Run sample',
        category: undefined,
        target: { projectPaths: ['/tmp/project'], sessionIds: undefined },
      },
    },
    expected: {
      family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.COMMANDS,
      contribution: {
        id: 'sample.run',
        title: 'Run sample',
        target: { projectPaths: ['/tmp/project'] },
      },
    },
  },
]

function invocationWith(payload: unknown) {
  return {
    extensionId: 'sample-extension',
    contributionId: 'sample.contribution',
    capability: 'openwaggle.sample',
    method: 'sample',
    scope: { kind: 'app' },
    payload,
  } as const
}

describe('normalizeInput', () => {
  it.each(PAYLOADS)(
    'drops explicit-undefined keys from a $kind payload so its schema accepts it',
    ({ decode, payload, expected }) => {
      const normalized = normalizeInput(invocationWith(payload))

      expect(decode(payload)._tag).toBe('Left')
      expect(normalized.payload).toStrictEqual(expected)
      expect(decode(normalized.payload)).toStrictEqual(Either.right(expected))
    },
  )

  it('drops explicit-undefined keys from objects inside arrays and keeps the array items', () => {
    const payload = { items: [{ id: 'a', note: undefined }, null, 'b'] }

    expect(normalizeInput(invocationWith(payload)).payload).toStrictEqual({
      items: [{ id: 'a' }, null, 'b'],
    })
  })

  it('keeps no payload key when the payload itself is undefined', () => {
    expect(normalizeInput(invocationWith(undefined))).not.toHaveProperty('payload')
  })
})
