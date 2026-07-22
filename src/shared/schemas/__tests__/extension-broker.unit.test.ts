import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { safeDecodeUnknown } from '@shared/schema'
import {
  extensionBrokerMethodSchema,
  extensionInvokeFailureCodeSchema,
  extensionInvokeInputSchema,
  extensionInvokeOutcomeSchema,
  extensionInvokeResultSchema,
} from '@shared/schemas/extension-broker'
import { describe, expect, it } from 'vitest'

const validInvocation = {
  extensionId: 'sample-extension',
  contributionId: 'sample.run',
  capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
  method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
  scope: { kind: 'branch', projectPath: '/tmp/project', sessionId: 'session-1', branchId: 'main' },
  payload: {},
}

describe('extension broker schemas', () => {
  it('accepts a valid extension invocation envelope', () => {
    const result = safeDecodeUnknown(extensionInvokeInputSchema, validInvocation)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.scope.kind).toBe('branch')
    }
  })

  it('rejects malformed invocation envelopes', () => {
    const result = safeDecodeUnknown(extensionInvokeInputSchema, {
      ...validInvocation,
      extensionId: 'Sample Extension',
    })

    expect(result.success).toBe(false)
  })

  it('accepts audited extension invocation results', () => {
    const result = safeDecodeUnknown(extensionInvokeResultSchema, {
      ok: false,
      error: {
        code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.OUT_OF_SCOPE,
        message: 'Outside scope.',
      },
      audit: {
        extensionId: 'sample-extension',
        contributionId: 'sample.run',
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
        scope: { kind: 'project', projectPath: '/tmp/project' },
        outcome: OPENWAGGLE_EXTENSION_BROKER.OUTCOME.REJECTED,
        timestamp: 1234,
        failureCode: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.OUT_OF_SCOPE,
      },
    })

    expect(result.success).toBe(true)
  })

  it('accepts audited extension storage invocation results', () => {
    const result = safeDecodeUnknown(extensionInvokeResultSchema, {
      ok: true,
      value: {
        extensionId: 'sample-extension',
        contributionId: 'sample.storage',
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SET,
        storageKind: 'config',
        storageScope: { kind: 'project', projectPath: '/tmp/project' },
        key: 'settings',
        value: { enabled: true },
        createdAt: 1234,
        updatedAt: 1234,
      },
      audit: {
        extensionId: 'sample-extension',
        contributionId: 'sample.storage',
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SET,
        scope: { kind: 'project', projectPath: '/tmp/project' },
        outcome: OPENWAGGLE_EXTENSION_BROKER.OUTCOME.SUCCEEDED,
        timestamp: 1234,
      },
    })

    expect(result.success).toBe(true)
  })

  it('accepts typed OpenWaggle state selector results', () => {
    const result = safeDecodeUnknown(extensionInvokeResultSchema, {
      ok: true,
      value: {
        extensionId: 'sample-extension',
        contributionId: 'sample.state',
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE,
        scope: { kind: 'project', projectPath: '/tmp/project' },
        selector: OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.CURRENT_PROJECT,
        value: {
          projectPath: '/tmp/project',
          displayName: 'OpenWaggle',
          active: true,
        },
      },
      audit: {
        extensionId: 'sample-extension',
        contributionId: 'sample.state',
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE,
        scope: { kind: 'project', projectPath: '/tmp/project' },
        outcome: OPENWAGGLE_EXTENSION_BROKER.OUTCOME.SUCCEEDED,
        timestamp: 1234,
      },
    })

    expect(result.success).toBe(true)
  })

  it('accepts typed OpenWaggle setting key results', () => {
    const result = safeDecodeUnknown(extensionInvokeResultSchema, {
      ok: true,
      value: {
        extensionId: 'sample-extension',
        contributionId: 'sample.settings',
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTING,
        setting: {
          key: OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.PROJECT_DISPLAY_NAME,
          projectPath: '/tmp/project',
          value: 'OpenWaggle',
        },
      },
      audit: {
        extensionId: 'sample-extension',
        contributionId: 'sample.settings',
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTING,
        scope: { kind: 'app' },
        outcome: OPENWAGGLE_EXTENSION_BROKER.OUTCOME.SUCCEEDED,
        timestamp: 1234,
      },
    })

    expect(result.success).toBe(true)
  })

  it('accepts runtime contribution registration results', () => {
    const result = safeDecodeUnknown(extensionInvokeResultSchema, {
      ok: true,
      value: {
        extensionId: 'sample-extension',
        contributionId: 'sample.settings',
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION,
        family: 'toolRenderers',
        registeredContributionId: 'sample.tool',
      },
      audit: {
        extensionId: 'sample-extension',
        contributionId: 'sample.settings',
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION,
        scope: { kind: 'project', projectPath: '/tmp/project' },
        outcome: OPENWAGGLE_EXTENSION_BROKER.OUTCOME.SUCCEEDED,
        timestamp: 1234,
      },
    })

    expect(result.success).toBe(true)
  })

  it('accepts every broker failure code configured in constants', () => {
    const results = Object.values(OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE).map((failureCode) =>
      safeDecodeUnknown(extensionInvokeFailureCodeSchema, failureCode),
    )

    expect(results.every((result) => result.success)).toBe(true)
  })

  it('accepts every broker outcome configured in constants', () => {
    const results = Object.values(OPENWAGGLE_EXTENSION_BROKER.OUTCOME).map((outcome) =>
      safeDecodeUnknown(extensionInvokeOutcomeSchema, outcome),
    )

    expect(results.every((result) => result.success)).toBe(true)
  })

  it('keeps built-in broker capability methods schema-decodable', () => {
    const results = OPENWAGGLE_EXTENSION_BROKER.CAPABILITY_METHODS.flatMap((descriptor) =>
      descriptor.methods.map((method) => safeDecodeUnknown(extensionBrokerMethodSchema, method)),
    )

    expect(results.every((result) => result.success)).toBe(true)
  })
})
