import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionInvokeInput } from '@shared/types/extension-broker'
import { describe, expect, it, vi } from 'vitest'
import { subscribeToSessionResourceInvalidations } from '../session-resource-invalidation'
import {
  BROKER_EXTENSION_ID,
  makeBrokerHarness,
  makeSessionDetail,
  SESSION_ID,
} from './extension-capability-broker-test-utils'
import {
  makeLifecycle,
  makePackage,
  PROJECT_PATH,
} from './extension-contribution-registry-test-utils'

const RESOURCE_CONTRIBUTION_ID = 'session-resources.manage'

function makeSessionResourcePackage() {
  return makePackage({
    id: BROKER_EXTENSION_ID,
    name: 'Session Resource Extension',
    scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
    capabilities: [
      {
        id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SESSION_RESOURCES,
        methods: [
          OPENWAGGLE_EXTENSION_BROKER.METHOD.PUBLISH_SESSION_RESOURCE,
          OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST_SESSION_RESOURCES,
        ],
        scopes: ['session'],
      },
    ],
    contributions: {
      commands: [
        {
          id: RESOURCE_CONTRIBUTION_ID,
          title: 'Publish session resource',
          target: { sessionIds: [String(SESSION_ID)] },
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SESSION_RESOURCES,
          methods: [
            OPENWAGGLE_EXTENSION_BROKER.METHOD.PUBLISH_SESSION_RESOURCE,
            OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST_SESSION_RESOURCES,
          ],
        },
      ],
    },
  })
}

function makeInvocation(input: {
  readonly method: string
  readonly payload: unknown
  readonly sessionId?: string
}): ExtensionInvokeInput {
  return {
    extensionId: BROKER_EXTENSION_ID,
    contributionId: RESOURCE_CONTRIBUTION_ID,
    capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SESSION_RESOURCES,
    method: input.method,
    scope: {
      kind: 'session',
      projectPath: PROJECT_PATH,
      sessionId: input.sessionId ?? String(SESSION_ID),
    },
    payload: input.payload,
  }
}

describe('invokeExtensionCapability Session Resources', () => {
  it('publishes and lists resources under the invoking Session authority', async () => {
    const invalidated = vi.fn()
    const unsubscribe = subscribeToSessionResourceInvalidations(invalidated)
    const extensionPackage = makeSessionResourcePackage()
    const harness = makeBrokerHarness({
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
      sessionDetail: makeSessionDetail(PROJECT_PATH),
      sessionResources: [],
    })

    const publishResult = await harness.run(
      makeInvocation({
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.PUBLISH_SESSION_RESOURCE,
        payload: {
          key: 'coverage-report',
          kind: 'file',
          title: 'Coverage report',
          activity: 'created',
          mimeType: 'text/html',
          reference: { kind: 'project-file', path: 'coverage/index.html' },
        },
      }),
    )
    const listResult = await harness.run(
      makeInvocation({
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST_SESSION_RESOURCES,
        payload: { category: 'outputs', limit: 10 },
      }),
    )
    unsubscribe()

    expect(publishResult).toMatchObject({
      ok: true,
      value: {
        sessionId: String(SESSION_ID),
        resource: {
          kind: 'file',
          title: 'Coverage report',
          source: false,
          output: true,
          occurrences: [{ actor: 'extension', activity: 'created' }],
        },
      },
    })
    expect(listResult).toMatchObject({
      ok: true,
      value: {
        sessionId: String(SESSION_ID),
        category: 'outputs',
        total: 1,
        resources: [
          {
            resourceId:
              publishResult.ok && 'resource' in publishResult.value
                ? publishResult.value.resource.resourceId
                : 'missing',
            title: 'Coverage report',
          },
        ],
      },
    })
    expect(invalidated).toHaveBeenCalledOnce()
    expect(invalidated).toHaveBeenCalledWith({ sessionId: SESSION_ID })
  })

  it('cannot redirect publication to a Session named inside the payload', async () => {
    const extensionPackage = makeSessionResourcePackage()
    const harness = makeBrokerHarness({
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
      sessionDetail: makeSessionDetail(PROJECT_PATH),
      sessionResources: [],
    })

    const result = await harness.run(
      makeInvocation({
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.PUBLISH_SESSION_RESOURCE,
        payload: {
          sessionId: 'other-session',
          resourceId: 'other-resource',
          key: 'scope-proof',
          kind: 'link',
          title: 'Scope proof',
          activity: 'read',
          reference: { kind: 'external-url', url: 'https://example.com/scope-proof' },
        },
      }),
    )

    expect(result).toMatchObject({
      ok: true,
      value: {
        sessionId: String(SESSION_ID),
        resource: { source: true, output: false },
      },
    })
    expect(harness.sessionResources()).toEqual([
      expect.objectContaining({ sessionId: SESSION_ID, title: 'Scope proof' }),
    ])
  })

  it('deduplicates an extension resource key while recording each publication', async () => {
    const extensionPackage = makeSessionResourcePackage()
    const harness = makeBrokerHarness({
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
      sessionDetail: makeSessionDetail(PROJECT_PATH),
      sessionResources: [],
    })
    const invocation = makeInvocation({
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.PUBLISH_SESSION_RESOURCE,
      payload: {
        key: 'stable-result',
        kind: 'file',
        title: 'Stable result',
        activity: 'updated',
        reference: { kind: 'project-file', path: 'reports/stable.txt' },
      },
    })

    await harness.run(invocation)
    await harness.run(invocation)

    expect(harness.sessionResources()).toEqual([
      expect.objectContaining({
        sessionId: SESSION_ID,
        title: 'Stable result',
        occurrences: [
          expect.objectContaining({ actor: 'extension', activity: 'updated' }),
          expect.objectContaining({ actor: 'extension', activity: 'updated' }),
        ],
      }),
    ])
  })

  it('rejects unsafe resource references without writing to the Session catalog', async () => {
    const extensionPackage = makeSessionResourcePackage()
    const harness = makeBrokerHarness({
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
      sessionDetail: makeSessionDetail(PROJECT_PATH),
      sessionResources: [],
    })

    const result = await harness.run(
      makeInvocation({
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.PUBLISH_SESSION_RESOURCE,
        payload: {
          key: 'outside-project',
          kind: 'file',
          title: 'Outside project',
          activity: 'read',
          reference: { kind: 'project-file', path: '../outside-project.txt' },
        },
      }),
    )

    expect(result).toMatchObject({
      ok: false,
      error: { code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD },
    })
    expect(harness.sessionResources()).toEqual([])
  })

  it('requires an approved Session Resource capability grant', async () => {
    const extensionPackage = makeSessionResourcePackage()
    const harness = makeBrokerHarness({
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage, { grantedCapabilities: [] })],
      sessionDetail: makeSessionDetail(PROJECT_PATH),
      sessionResources: [],
    })

    const result = await harness.run(
      makeInvocation({
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.PUBLISH_SESSION_RESOURCE,
        payload: {
          key: 'unapproved-resource',
          kind: 'file',
          title: 'Unapproved resource',
          activity: 'created',
        },
      }),
    )

    expect(result).toMatchObject({
      ok: false,
      error: { code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.DISABLED_EXTENSION },
    })
    expect(harness.sessionResources()).toEqual([])
  })
})
