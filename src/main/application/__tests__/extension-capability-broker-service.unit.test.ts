import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { describe, expect, it } from 'vitest'
import { makeExpectBrokerFailure } from './extension-capability-broker-assertions'
import {
  BROKER_CONTRIBUTION_ID,
  BROKER_EXTENSION_ID,
  type CapturedLog,
  makeBrokerPackage,
  makeProjectInvocation,
  runBroker,
  TIMESTAMP,
} from './extension-capability-broker-test-utils'
import {
  makeLifecycle,
  makePackage,
  makeProjectOverride,
  PROJECT_PATH,
} from './extension-contribution-registry-test-utils'

const expectFailure = makeExpectBrokerFailure(TIMESTAMP)

describe('invokeExtensionCapability', () => {
  it('routes a declared broker capability and audits success', async () => {
    const extensionPackage = makeBrokerPackage()
    const capturedLogs: CapturedLog[] = []
    const result = await runBroker({
      invocation: makeProjectInvocation(),
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
      capturedLogs,
    })

    if (!result.ok) {
      throw new Error(`Expected success, got ${result.error.code}.`)
    }

    expect(result.value).toMatchObject({
      extensionId: BROKER_EXTENSION_ID,
      contributionId: BROKER_CONTRIBUTION_ID,
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
      scope: { kind: 'project', projectPath: PROJECT_PATH },
      declaredScopes: ['app', 'project', 'session', 'branch'],
    })
    expect(result.audit).toMatchObject({
      extensionId: BROKER_EXTENSION_ID,
      contributionId: BROKER_CONTRIBUTION_ID,
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
      scope: { kind: 'project', projectPath: PROJECT_PATH },
      outcome: OPENWAGGLE_EXTENSION_BROKER.OUTCOME.SUCCEEDED,
      timestamp: TIMESTAMP,
    })
    expect(capturedLogs).toEqual([
      expect.objectContaining({
        namespace: 'extension-broker',
        message: 'Extension capability call audited',
      }),
    ])
  })

  it('rejects unknown extensions', async () => {
    const result = await runBroker({ invocation: makeProjectInvocation() })

    expectFailure(result, OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNKNOWN_EXTENSION)
  })

  it('rejects disabled extensions', async () => {
    const extensionPackage = makeBrokerPackage()
    const result = await runBroker({
      invocation: makeProjectInvocation(),
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage, { enabled: false })],
    })

    expectFailure(result, OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.DISABLED_EXTENSION)
  })

  it('rejects project-disabled extension invocations', async () => {
    const extensionPackage = makeBrokerPackage()
    const result = await runBroker({
      invocation: makeProjectInvocation(),
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
      projectOverrides: [
        makeProjectOverride({ extensionPackage, projectPath: PROJECT_PATH, disabled: true }),
      ],
    })

    expectFailure(result, OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.DISABLED_EXTENSION)
  })

  it('rejects unknown contributions', async () => {
    const extensionPackage = makeBrokerPackage()
    const result = await runBroker({
      invocation: makeProjectInvocation({ contributionId: 'missing.run' }),
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
    })

    expectFailure(result, OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNKNOWN_CONTRIBUTION)
  })

  it('rejects undeclared capabilities', async () => {
    const extensionPackage = makeBrokerPackage()
    const result = await runBroker({
      invocation: makeProjectInvocation({ capability: 'missing.capability' }),
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
    })

    expectFailure(result, OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNDECLARED_CAPABILITY)
  })

  it('rejects contributions that omit the requested capability binding', async () => {
    const extensionPackage = makePackage({
      id: BROKER_EXTENSION_ID,
      name: 'Broker Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      capabilities: [
        {
          id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
          methods: [OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE],
          scopes: ['project'],
        },
      ],
      contributions: {
        commands: [
          {
            id: BROKER_CONTRIBUTION_ID,
            title: 'Run Broker',
            method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
          },
        ],
      },
    })
    const result = await runBroker({
      invocation: makeProjectInvocation(),
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
    })

    expectFailure(result, OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNDECLARED_CAPABILITY)
  })

  it('rejects undeclared methods', async () => {
    const extensionPackage = makeBrokerPackage()
    const result = await runBroker({
      invocation: makeProjectInvocation({ method: 'delete' }),
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
    })

    expectFailure(result, OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNDECLARED_METHOD)
  })

  it('rejects contributions that omit the requested method binding', async () => {
    const extensionPackage = makePackage({
      id: BROKER_EXTENSION_ID,
      name: 'Broker Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      capabilities: [
        {
          id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
          methods: [OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE],
          scopes: ['project'],
        },
      ],
      contributions: {
        commands: [
          {
            id: BROKER_CONTRIBUTION_ID,
            title: 'Run Broker',
            capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
          },
        ],
      },
    })
    const result = await runBroker({
      invocation: makeProjectInvocation(),
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
    })

    expectFailure(result, OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNDECLARED_METHOD)
  })

  it('rejects contributions whose method binding differs from the requested method', async () => {
    const extensionPackage = makePackage({
      id: BROKER_EXTENSION_ID,
      name: 'Broker Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      capabilities: [
        {
          id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
          methods: [OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE, 'inspect'],
          scopes: ['project'],
        },
      ],
      contributions: {
        commands: [
          {
            id: BROKER_CONTRIBUTION_ID,
            title: 'Run Broker',
            capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
            method: 'inspect',
          },
        ],
      },
    })
    const result = await runBroker({
      invocation: makeProjectInvocation(),
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
    })

    expectFailure(result, OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNDECLARED_METHOD)
  })

  it('rejects undeclared capability scopes', async () => {
    const extensionPackage = makePackage({
      id: BROKER_EXTENSION_ID,
      name: 'Broker Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      capabilities: [
        {
          id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
          methods: [OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE],
          scopes: ['app'],
        },
      ],
      contributions: {
        commands: [
          {
            id: BROKER_CONTRIBUTION_ID,
            title: 'Run Broker',
            capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
            method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
          },
        ],
      },
    })
    const result = await runBroker({
      invocation: makeProjectInvocation(),
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
    })

    expectFailure(result, OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNDECLARED_SCOPE)
  })

  it('rejects invalid payloads for routed capabilities', async () => {
    const extensionPackage = makeBrokerPackage()
    const result = await runBroker({
      invocation: makeProjectInvocation({ payload: { extra: true } }),
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
    })

    expectFailure(result, OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD)
  })
})
