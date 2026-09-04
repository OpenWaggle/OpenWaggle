import * as Schema from 'effect/Schema'
import { describe, expect, it, vi } from 'vitest'
import {
  createExtensionBrokerSdk,
  type ExtensionBrokerTransport,
  type ExtensionCapabilityAuditEntry,
  type ExtensionInvokeInput,
  extensionSessionResourceListPayloadSchema,
  extensionSessionResourcePublishPayloadSchema,
  OPENWAGGLE_EXTENSION_BROKER,
} from '../index.js'

const SESSION_SCOPE = {
  kind: 'session',
  projectPath: '/tmp/project',
  sessionId: 'session-1',
} as const
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

describe('extension Session Resource SDK', () => {
  it('rejects unsafe references and unbounded list requests at the public boundary', () => {
    for (const reference of [
      { kind: 'external-url', url: 'http://example.com/report' },
      { kind: 'external-url', url: 'https://user:secret@example.com/report' },
      { kind: 'project-file', path: '../outside-project.txt' },
      { kind: 'project-file', path: '/tmp/outside-project.txt' },
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(extensionSessionResourcePublishPayloadSchema)({
          key: 'unsafe-resource',
          kind: 'file',
          title: 'Unsafe resource',
          activity: 'read',
          reference,
        }),
      ).toThrow()
    }

    expect(() =>
      Schema.decodeUnknownSync(extensionSessionResourceListPayloadSchema)({ limit: 201 }),
    ).toThrow()
  })

  it('publishes a resource into the invoking session without accepting a session id payload', async () => {
    const transport = vi.fn<ExtensionBrokerTransport>(async (input) => ({
      ok: true,
      value: {
        extensionId: input.extensionId,
        contributionId: input.contributionId,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SESSION_RESOURCES,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.PUBLISH_SESSION_RESOURCE,
        sessionId: SESSION_SCOPE.sessionId,
        resource: {
          resourceId: 'resource-1',
          kind: 'file',
          title: 'Coverage report',
          mimeType: 'text/html',
          available: true,
          source: false,
          output: true,
          occurrences: [
            {
              actor: 'extension',
              activity: 'created',
              label: 'QA extension',
              createdAt: TIMESTAMP,
            },
          ],
          createdAt: TIMESTAMP,
          updatedAt: TIMESTAMP,
        },
      },
      audit: auditFor(input),
    }))
    const sdk = createExtensionBrokerSdk(transport, {
      extensionId: 'qa-extension',
      contributionId: 'qa.publish',
    })

    const result = await sdk.openWaggle.sessionResources.publish(SESSION_SCOPE, {
      key: 'coverage-report',
      kind: 'file',
      title: 'Coverage report',
      activity: 'created',
      mimeType: 'text/html',
      reference: { kind: 'project-file', path: 'coverage/index.html' },
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        sessionId: SESSION_SCOPE.sessionId,
        resource: { resourceId: 'resource-1', output: true },
      },
    })
    expect(transport).toHaveBeenCalledWith({
      extensionId: 'qa-extension',
      contributionId: 'qa.publish',
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SESSION_RESOURCES,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.PUBLISH_SESSION_RESOURCE,
      scope: SESSION_SCOPE,
      payload: {
        key: 'coverage-report',
        kind: 'file',
        title: 'Coverage report',
        activity: 'created',
        mimeType: 'text/html',
        reference: { kind: 'project-file', path: 'coverage/index.html' },
      },
    })
  })

  it('lists a bounded category from only the invoking session', async () => {
    const transport = vi.fn<ExtensionBrokerTransport>(async (input) => ({
      ok: true,
      value: {
        extensionId: input.extensionId,
        contributionId: input.contributionId,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SESSION_RESOURCES,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST_SESSION_RESOURCES,
        sessionId: SESSION_SCOPE.sessionId,
        category: 'sources',
        total: 0,
        resources: [],
      },
      audit: auditFor(input),
    }))
    const sdk = createExtensionBrokerSdk(transport, {
      extensionId: 'qa-extension',
      contributionId: 'qa.sources',
    })

    const result = await sdk.openWaggle.sessionResources.list(SESSION_SCOPE, {
      category: 'sources',
      limit: 25,
    })

    expect(result).toMatchObject({
      ok: true,
      value: { sessionId: SESSION_SCOPE.sessionId, category: 'sources', total: 0 },
    })
    expect(transport).toHaveBeenCalledWith({
      extensionId: 'qa-extension',
      contributionId: 'qa.sources',
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SESSION_RESOURCES,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST_SESSION_RESOURCES,
      scope: SESSION_SCOPE,
      payload: { category: 'sources', limit: 25 },
    })
  })

  it('rejects a broker response bound to a different Session', async () => {
    const transport = vi.fn<ExtensionBrokerTransport>(async (input) => ({
      ok: true,
      value: {
        extensionId: input.extensionId,
        contributionId: input.contributionId,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SESSION_RESOURCES,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST_SESSION_RESOURCES,
        sessionId: 'other-session',
        category: 'all',
        total: 0,
        resources: [],
      },
      audit: auditFor(input),
    }))
    const sdk = createExtensionBrokerSdk(transport, {
      extensionId: 'qa-extension',
      contributionId: 'qa.sources',
    })

    const result = await sdk.openWaggle.sessionResources.list(SESSION_SCOPE)

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD,
        message: 'Extension broker returned an invalid Session Resource result.',
      },
    })
  })
})
