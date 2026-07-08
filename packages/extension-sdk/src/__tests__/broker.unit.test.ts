import { describe, expect, it, vi } from 'vitest'
import {
  createExtensionBrokerSdk,
  type ExtensionBrokerTransport,
  type ExtensionCapabilityAuditEntry,
  type ExtensionInvokeInput,
  OPENWAGGLE_EXTENSION,
  OPENWAGGLE_EXTENSION_BROKER,
} from '../index.js'

const APP_SCOPE = { kind: 'app' } as const
const PROJECT_SCOPE = { kind: 'project', projectPath: '/tmp/project' } as const
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

describe('createExtensionBrokerSdk', () => {
  it('rejects storage success payloads that do not match the requested operation', async () => {
    const transport = vi.fn<ExtensionBrokerTransport>(async (input) => ({
      ok: true,
      value: {
        extensionId: input.extensionId,
        contributionId: input.contributionId,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
        scope: input.scope,
        declaredScopes: ['app'],
      },
      audit: auditFor(input),
    }))
    const sdk = createExtensionBrokerSdk(transport, {
      extensionId: 'sample-extension',
      contributionId: 'sample.status',
    })

    const result = await sdk.storage.packageState.global.get(APP_SCOPE, 'cache')

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD,
        message: 'Extension broker returned an invalid storage result.',
      },
      audit: {
        extensionId: 'sample-extension',
        contributionId: 'sample.status',
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET,
      },
    })
  })

  it('rejects runtime contribution success payloads that do not match the requested operation', async () => {
    const transport = vi.fn<ExtensionBrokerTransport>(async (input) => ({
      ok: true,
      value: {
        extensionId: input.extensionId,
        contributionId: input.contributionId,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET,
        storageKind: OPENWAGGLE_EXTENSION.STORAGE.KIND.STATE,
        storageScope: { kind: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND },
        key: 'cache',
        value: null,
      },
      audit: auditFor(input),
    }))
    const sdk = createExtensionBrokerSdk(transport, {
      extensionId: 'sample-extension',
      contributionId: 'sample.settings',
    })

    const result = await sdk.runtime.registerContribution(PROJECT_SCOPE, {
      family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.STATUS_WIDGETS,
      contribution: {
        id: 'sample.status',
        title: 'Sample status',
        runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
        execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
        entry: 'dist/status.js',
      },
    })

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD,
        message: 'Extension broker returned an invalid runtime contribution result.',
      },
      audit: {
        extensionId: 'sample-extension',
        contributionId: 'sample.settings',
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION,
      },
    })
  })

  it('rejects docs discovery successes with malformed docs payloads', async () => {
    const transport = vi.fn<ExtensionBrokerTransport>(async (input) => ({
      ok: true,
      value: {
        extensionId: input.extensionId,
        contributionId: input.contributionId,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.DISCOVER_DOCS,
        docs: null,
      },
      audit: auditFor(input),
    }))
    const sdk = createExtensionBrokerSdk(transport, {
      extensionId: 'sample-extension',
      contributionId: 'sample.docs',
    })

    const result = await sdk.openWaggle.docs.discover(APP_SCOPE, { includeExtensions: false })

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD,
        message: 'Extension broker returned an invalid OpenWaggle docs result.',
      },
      audit: {
        extensionId: 'sample-extension',
        contributionId: 'sample.docs',
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.DISCOVER_DOCS,
      },
    })
  })

  it('rejects docs topic resolution successes with malformed resolved topics', async () => {
    const transport = vi.fn<ExtensionBrokerTransport>(async (input) => ({
      ok: true,
      value: {
        extensionId: input.extensionId,
        contributionId: input.contributionId,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.RESOLVE_DOCS_TOPIC,
        resolvedTopic: { bad: true },
      },
      audit: auditFor(input),
    }))
    const sdk = createExtensionBrokerSdk(transport, {
      extensionId: 'sample-extension',
      contributionId: 'sample.docs',
    })

    const result = await sdk.openWaggle.docs.resolveTopic(APP_SCOPE, {
      topic: 'openwaggle:extending/openwaggle-extensions',
    })

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD,
        message: 'Extension broker returned an invalid OpenWaggle docs result.',
      },
      audit: {
        extensionId: 'sample-extension',
        contributionId: 'sample.docs',
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.RESOLVE_DOCS_TOPIC,
      },
    })
  })
})
