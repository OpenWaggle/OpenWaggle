import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { describe, expect, it } from 'vitest'
import { makeExpectBrokerFailure } from './extension-capability-broker-assertions'
import {
  BRANCH_ID,
  BROKER_CONTRIBUTION_ID,
  BROKER_EXTENSION_ID,
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
  OTHER_PROJECT_PATH,
  PROJECT_PATH,
} from './extension-contribution-registry-test-utils'

const expectFailure = makeExpectBrokerFailure(TIMESTAMP)

describe('invokeExtensionCapability scope boundaries', () => {
  it('routes session-targeted contributions through session-scoped invocations', async () => {
    const extensionPackage = makePackage({
      id: BROKER_EXTENSION_ID,
      name: 'Session Broker Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      capabilities: [
        {
          id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
          methods: [OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE],
          scopes: ['session'],
        },
      ],
      contributions: {
        commands: [
          {
            id: BROKER_CONTRIBUTION_ID,
            title: 'Run Session Broker',
            target: { sessionIds: [String(SESSION_ID)] },
            capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
            method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
          },
        ],
      },
    })
    const result = await runBroker({
      invocation: makeProjectInvocation({
        scope: { kind: 'session', projectPath: PROJECT_PATH, sessionId: String(SESSION_ID) },
      }),
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
      sessionDetail: makeSessionDetail(PROJECT_PATH),
    })

    if (!result.ok) {
      throw new Error(`Expected success, got ${result.error.code}.`)
    }

    expect(result.value).toMatchObject({
      extensionId: BROKER_EXTENSION_ID,
      contributionId: BROKER_CONTRIBUTION_ID,
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
      scope: { kind: 'session', projectPath: PROJECT_PATH, sessionId: String(SESSION_ID) },
      declaredScopes: ['session'],
    })
  })

  it('rejects project invocations outside the active project', async () => {
    const extensionPackage = makeBrokerPackage()
    const result = await runBroker({
      invocation: makeProjectInvocation({
        scope: { kind: 'project', projectPath: OTHER_PROJECT_PATH },
      }),
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
      currentProjectPath: PROJECT_PATH,
    })

    expectFailure(result, OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.OUT_OF_SCOPE)
  })

  it('rejects session invocations outside the active project', async () => {
    const extensionPackage = makeBrokerPackage()
    const result = await runBroker({
      invocation: makeProjectInvocation({
        scope: {
          kind: 'session',
          projectPath: OTHER_PROJECT_PATH,
          sessionId: String(SESSION_ID),
        },
      }),
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
      sessionDetail: makeSessionDetail(OTHER_PROJECT_PATH),
      currentProjectPath: PROJECT_PATH,
    })

    expectFailure(result, OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.OUT_OF_SCOPE)
  })

  it('rejects branch invocations outside the active project', async () => {
    const extensionPackage = makeBrokerPackage()
    const result = await runBroker({
      invocation: makeProjectInvocation({
        scope: {
          kind: 'branch',
          projectPath: OTHER_PROJECT_PATH,
          sessionId: String(SESSION_ID),
          branchId: String(BRANCH_ID),
        },
      }),
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
      sessionTree: makeSessionTree(OTHER_PROJECT_PATH),
      currentProjectPath: PROJECT_PATH,
    })

    expectFailure(result, OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.OUT_OF_SCOPE)
  })

  it('rejects session invocations whose session belongs to another project', async () => {
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

  it('rejects branch invocations whose branch is missing', async () => {
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
