import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import type {
  ExtensionCapabilityAuditEntry,
  ExtensionInvokeInput,
  ExtensionInvokeResult,
} from '@shared/types/extension-broker'
import { describe, expect, it, vi } from 'vitest'
import { createExtensionBrokerSdk, type ExtensionBrokerTransport } from '../extension-sdk'

const PROJECT_SCOPE = { kind: 'project', projectPath: '/tmp/project' } as const
const APP_SCOPE = { kind: 'app' } as const
const TIMESTAMP = 1234

function auditFor(input: ExtensionInvokeInput): ExtensionCapabilityAuditEntry {
  return {
    extensionId: input.extensionId,
    contributionId: input.contributionId,
    capability: input.capability,
    method: input.method,
    scope: input.scope,
    outcome: OPENWAGGLE_EXTENSION_BROKER.OUTCOME.SUCCEEDED,
    timestamp: TIMESTAMP,
  }
}

function docsTransportResult(input: ExtensionInvokeInput): ExtensionInvokeResult {
  if (input.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.DISCOVER_DOCS) {
    return {
      ok: true,
      value: {
        extensionId: input.extensionId,
        contributionId: input.contributionId,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.DISCOVER_DOCS,
        docs: {
          generatedAt: '2026-01-01T00:00:00.000Z',
          bundlePath: '/tmp/openwaggle-docs',
          firstPartyTopics: [],
          extensionTopics: [],
          diagnostics: [],
        },
      },
      audit: auditFor(input),
    }
  }

  return {
    ok: true,
    value: {
      extensionId: input.extensionId,
      contributionId: input.contributionId,
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.RESOLVE_DOCS_TOPIC,
      resolvedTopic: null,
    },
    audit: auditFor(input),
  }
}

describe('createExtensionBrokerSdk OpenWaggle docs helpers', () => {
  it('builds typed OpenWaggle docs discovery calls', async () => {
    const transport = vi.fn<ExtensionBrokerTransport>(async (input) => docsTransportResult(input))
    const sdk = createExtensionBrokerSdk(transport, {
      extensionId: 'sample-extension',
      contributionId: 'sample.docs',
    })

    const discoverResult = await sdk.openWaggle.docs.discover(PROJECT_SCOPE, {
      includeExtensions: false,
    })
    const resolveResult = await sdk.openWaggle.docs.resolveTopic(APP_SCOPE, {
      topic: 'openwaggle:extending/openwaggle-extensions',
    })

    expect(discoverResult).toMatchObject({
      ok: true,
      value: {
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.DISCOVER_DOCS,
        docs: { bundlePath: '/tmp/openwaggle-docs' },
      },
    })
    expect(resolveResult).toMatchObject({
      ok: true,
      value: {
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.RESOLVE_DOCS_TOPIC,
        resolvedTopic: null,
      },
    })
    expect(transport).toHaveBeenNthCalledWith(1, {
      extensionId: 'sample-extension',
      contributionId: 'sample.docs',
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.DISCOVER_DOCS,
      scope: PROJECT_SCOPE,
      payload: { includeExtensions: false },
    })
    expect(transport).toHaveBeenNthCalledWith(2, {
      extensionId: 'sample-extension',
      contributionId: 'sample.docs',
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.RESOLVE_DOCS_TOPIC,
      scope: APP_SCOPE,
      payload: {
        topic: 'openwaggle:extending/openwaggle-extensions',
      },
    })
  })
})
