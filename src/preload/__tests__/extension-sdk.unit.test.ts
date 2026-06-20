import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
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

function storageTransportResult(input: ExtensionInvokeInput): ExtensionInvokeResult {
  const audit = auditFor(input)

  if (input.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.GET) {
    return {
      ok: true,
      value: {
        extensionId: input.extensionId,
        contributionId: input.contributionId,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET,
        storageKind: OPENWAGGLE_EXTENSION.STORAGE.KIND.CONFIG,
        storageScope: {
          kind: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND,
          projectPath: PROJECT_SCOPE.projectPath,
        },
        key: 'settings',
        value: { enabled: true },
      },
      audit,
    }
  }

  return {
    ok: true,
    value: {
      extensionId: input.extensionId,
      contributionId: input.contributionId,
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SET,
      storageKind: OPENWAGGLE_EXTENSION.STORAGE.KIND.CONFIG,
      storageScope: {
        kind: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND,
        projectPath: PROJECT_SCOPE.projectPath,
      },
      key: 'settings',
      value: { enabled: true },
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    },
    audit,
  }
}

describe('createExtensionBrokerSdk storage helpers', () => {
  it('builds package storage calls for different contributions from the same extension package', async () => {
    const transport = vi.fn<ExtensionBrokerTransport>(async (input) =>
      storageTransportResult(input),
    )
    const settingsSdk = createExtensionBrokerSdk(transport, {
      extensionId: 'sample-extension',
      contributionId: 'sample.settings',
    })
    const panelSdk = createExtensionBrokerSdk(transport, {
      extensionId: 'sample-extension',
      contributionId: 'sample.panel',
    })

    const setResult = await settingsSdk.storage.packageConfig.project.set(
      PROJECT_SCOPE,
      'settings',
      { enabled: true },
    )
    const getResult = await panelSdk.storage.packageConfig.project.get(PROJECT_SCOPE, 'settings')

    expect(setResult).toMatchObject({
      ok: true,
      value: {
        contributionId: 'sample.settings',
        storageKind: OPENWAGGLE_EXTENSION.STORAGE.KIND.CONFIG,
        storageScope: {
          kind: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND,
          projectPath: PROJECT_SCOPE.projectPath,
        },
        value: { enabled: true },
      },
    })
    expect(getResult).toMatchObject({
      ok: true,
      value: {
        contributionId: 'sample.panel',
        storageKind: OPENWAGGLE_EXTENSION.STORAGE.KIND.CONFIG,
        storageScope: {
          kind: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND,
          projectPath: PROJECT_SCOPE.projectPath,
        },
        value: { enabled: true },
      },
    })
    expect(transport).toHaveBeenNthCalledWith(1, {
      extensionId: 'sample-extension',
      contributionId: 'sample.settings',
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SET,
      scope: PROJECT_SCOPE,
      payload: {
        storageKind: OPENWAGGLE_EXTENSION.STORAGE.KIND.CONFIG,
        storageScope: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND,
        key: 'settings',
        value: { enabled: true },
      },
    })
    expect(transport).toHaveBeenNthCalledWith(2, {
      extensionId: 'sample-extension',
      contributionId: 'sample.panel',
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET,
      scope: PROJECT_SCOPE,
      payload: {
        storageKind: OPENWAGGLE_EXTENSION.STORAGE.KIND.CONFIG,
        storageScope: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND,
        key: 'settings',
      },
    })
  })

  it('builds app-data package state calls through the global storage wrapper', async () => {
    const transport = vi.fn<ExtensionBrokerTransport>(async (input) => ({
      ok: true,
      value: {
        extensionId: input.extensionId,
        contributionId: input.contributionId,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST,
        storageKind: OPENWAGGLE_EXTENSION.STORAGE.KIND.STATE,
        storageScope: { kind: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND },
        keys: ['cache'],
      },
      audit: auditFor(input),
    }))
    const sdk = createExtensionBrokerSdk(transport, {
      extensionId: 'sample-extension',
      contributionId: 'sample.status',
    })

    const result = await sdk.storage.packageState.global.list(APP_SCOPE)

    expect(result).toMatchObject({
      ok: true,
      value: {
        storageKind: OPENWAGGLE_EXTENSION.STORAGE.KIND.STATE,
        storageScope: { kind: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND },
        keys: ['cache'],
      },
    })
    expect(transport).toHaveBeenCalledWith({
      extensionId: 'sample-extension',
      contributionId: 'sample.status',
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST,
      scope: APP_SCOPE,
      payload: {
        storageKind: OPENWAGGLE_EXTENSION.STORAGE.KIND.STATE,
        storageScope: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND,
      },
    })
  })

  it('rejects success payloads that do not match the requested storage operation type', async () => {
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
})

describe('createExtensionBrokerSdk runtime contribution helpers', () => {
  it('builds dynamic contribution registration calls through the generic broker', async () => {
    const transport = vi.fn<ExtensionBrokerTransport>(async (input) => ({
      ok: true,
      value: {
        extensionId: input.extensionId,
        contributionId: input.contributionId,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION,
        family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.TOOL_RENDERERS,
        registeredContributionId: 'sample.tool',
      },
      audit: auditFor(input),
    }))
    const sdk = createExtensionBrokerSdk(transport, {
      extensionId: 'sample-extension',
      contributionId: 'sample.settings',
    })
    const registration = {
      family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.TOOL_RENDERERS,
      contribution: {
        id: 'sample.tool',
        title: 'Sample Tool',
        runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
        execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
        entry: 'dist/tool.js',
      },
    } as const

    const result = await sdk.runtime.registerContribution(PROJECT_SCOPE, registration)

    expect(result).toMatchObject({
      ok: true,
      value: {
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION,
        registeredContributionId: 'sample.tool',
      },
    })
    expect(transport).toHaveBeenCalledWith({
      extensionId: 'sample-extension',
      contributionId: 'sample.settings',
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION,
      scope: PROJECT_SCOPE,
      payload: registration,
    })
  })

  it('builds dynamic contribution unregistration calls through the generic broker', async () => {
    const transport = vi.fn<ExtensionBrokerTransport>(async (input) => ({
      ok: true,
      value: {
        extensionId: input.extensionId,
        contributionId: input.contributionId,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UNREGISTER_CONTRIBUTION,
        family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.TOOL_RENDERERS,
        unregisteredContributionId: 'sample.tool',
        unregistered: true,
      },
      audit: auditFor(input),
    }))
    const sdk = createExtensionBrokerSdk(transport, {
      extensionId: 'sample-extension',
      contributionId: 'sample.settings',
    })
    const unregistration = {
      family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.TOOL_RENDERERS,
      contributionId: 'sample.tool',
    } as const

    const result = await sdk.runtime.unregisterContribution(PROJECT_SCOPE, unregistration)

    expect(result).toMatchObject({
      ok: true,
      value: {
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UNREGISTER_CONTRIBUTION,
        unregisteredContributionId: 'sample.tool',
        unregistered: true,
      },
    })
    expect(transport).toHaveBeenCalledWith({
      extensionId: 'sample-extension',
      contributionId: 'sample.settings',
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UNREGISTER_CONTRIBUTION,
      scope: PROJECT_SCOPE,
      payload: unregistration,
    })
  })
})
