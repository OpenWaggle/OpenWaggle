import { describe, expect, it, vi } from 'vitest'
import { type ExtensionBrokerTransport, OPENWAGGLE_EXTENSION_BROKER } from '../index.js'
import { createExtensionBrokerSdk } from '../testing.js'

const APP_SCOPE = { kind: 'app' } as const
const IDENTITY = { extensionId: 'sample-extension', contributionId: 'sample.docs' }

/** A transport that answers every call with `value` as the broker's success. */
function answering(value: (input: Parameters<ExtensionBrokerTransport>[0]) => object) {
  return vi.fn<ExtensionBrokerTransport>(async (input) => ({
    ok: true,
    value: value(input),
    audit: {
      extensionId: input.extensionId,
      contributionId: input.contributionId,
      capability: input.capability,
      method: input.method,
      scope: input.scope,
      outcome: OPENWAGGLE_EXTENSION_BROKER.OUTCOME.SUCCEEDED,
      timestamp: 1,
    },
  }))
}

function settingsResult(input: Parameters<ExtensionBrokerTransport>[0], thinkingLevel: string) {
  return {
    extensionId: input.extensionId,
    contributionId: input.contributionId,
    capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
    method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTINGS,
    settings: {
      modelPreferences: {
        selectedModel: 'model',
        favoriteModels: [],
        enabledModels: [],
        thinkingLevel,
      },
      projectDisplayNames: {},
    },
  }
}

describe('broker result decoding', () => {
  // The SDK decodes docs results with the schemas their types come from (docs.ts); the earlier
  // hand-written guard accepted any string in a topic's aliases.
  it('refuses a resolved topic whose aliases hold an empty string, naming the field', async () => {
    const resolvedTopic = {
      topic: 'openwaggle:extending/openwaggle-extensions',
      source: 'openwaggle',
      group: 'Extending',
      title: 'Extensions',
      order: 1,
      path: 'extending/openwaggle-extensions.md',
      bundlePath: '/docs',
      sourcePath: '/docs/extending/openwaggle-extensions.md',
      aliases: [''],
      keywords: [],
      contentHash: 'hash',
    }
    const transport = vi.fn<ExtensionBrokerTransport>(async (input) => ({
      ok: true,
      value: {
        extensionId: input.extensionId,
        contributionId: input.contributionId,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.RESOLVE_DOCS_TOPIC,
        resolvedTopic,
      },
      audit: {
        extensionId: input.extensionId,
        contributionId: input.contributionId,
        capability: input.capability,
        method: input.method,
        scope: input.scope,
        outcome: OPENWAGGLE_EXTENSION_BROKER.OUTCOME.SUCCEEDED,
        timestamp: 1,
      },
    }))
    const sdk = createExtensionBrokerSdk(transport, {
      extensionId: 'sample-extension',
      contributionId: 'sample.docs',
    })

    const result = await sdk.openWaggle.docs.resolveTopic(APP_SCOPE, { topic: resolvedTopic.topic })

    expect(result).toMatchObject({
      ok: false,
      error: {
        issues: expect.arrayContaining([expect.stringMatching(/^resolvedTopic\.aliases\.0: /u)]),
      },
    })
  })

  // The SDK has declared the thinking level as a string since 0.2, so a level a later Pi adds still
  // decodes.
  it.each(['high', 'a level a later Pi adds'])(
    'accepts a model preference with the thinking level %s',
    async (thinkingLevel) => {
      const sdk = createExtensionBrokerSdk(
        answering((input) => settingsResult(input, thinkingLevel)),
        IDENTITY,
      )

      const result = await sdk.openWaggle.settings.get(APP_SCOPE)

      expect(result).toMatchObject({
        ok: true,
        value: { settings: { modelPreferences: { thinkingLevel } } },
      })
    },
  )
})
