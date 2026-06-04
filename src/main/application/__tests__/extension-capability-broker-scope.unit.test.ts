import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { describe, it } from 'vitest'
import { makeExpectBrokerFailure } from './extension-capability-broker-assertions'
import {
  BRANCH_ID,
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
  OTHER_PROJECT_PATH,
  PROJECT_PATH,
} from './extension-contribution-registry-test-utils'

const expectFailure = makeExpectBrokerFailure(TIMESTAMP)

describe('invokeExtensionCapability scope boundaries', () => {
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
