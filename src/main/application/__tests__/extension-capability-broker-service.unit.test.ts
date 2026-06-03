import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionInvokeFailureCode } from '@shared/types/extension-broker'
import { describe, expect, it } from 'vitest'
import {
  BROKER_CONTRIBUTION_ID,
  BROKER_EXTENSION_ID,
  type CapturedLog,
  makeBrokerPackage,
  makeProjectInvocation,
  makeSessionDetail,
  makeSessionTree,
  runBroker,
  SESSION_ID,
  TIMESTAMP,
} from './extension-capability-broker-test-utils'
import {
  makeLifecycle,
  makePackage,
  makeProjectOverride,
  OTHER_PROJECT_PATH,
  PROJECT_PATH,
} from './extension-contribution-registry-test-utils'

function expectFailure(
  result: Awaited<ReturnType<typeof runBroker>>,
  code: ExtensionInvokeFailureCode,
) {
  if (result.ok) {
    throw new Error('Expected broker invocation to fail.')
  }

  expect(result.error.code).toBe(code)
  expect(result.audit?.failureCode).toBe(code)
  expect(result.audit?.outcome).toBe(OPENWAGGLE_EXTENSION_BROKER.OUTCOME.REJECTED)
  expect(result.audit?.timestamp).toBe(TIMESTAMP)
}

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

  it('rejects out-of-scope session invocations', async () => {
    const extensionPackage = makeBrokerPackage()
    const result = await runBroker({
      invocation: makeProjectInvocation({
        scope: { kind: 'session', projectPath: PROJECT_PATH, sessionId: String(SESSION_ID) },
      }),
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
      sessionDetail: makeSessionDetail(OTHER_PROJECT_PATH),
    })

    expectFailure(result, OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.OUT_OF_SCOPE)
  })

  it('rejects out-of-scope branch invocations', async () => {
    const extensionPackage = makeBrokerPackage()
    const result = await runBroker({
      invocation: makeProjectInvocation({
        scope: {
          kind: 'branch',
          projectPath: PROJECT_PATH,
          sessionId: String(SESSION_ID),
          branchId: 'missing-branch',
        },
      }),
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
      sessionTree: makeSessionTree(PROJECT_PATH),
    })

    expectFailure(result, OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.OUT_OF_SCOPE)
  })
})
