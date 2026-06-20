import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearExtensionContributionRegistryCacheForTests,
  registerRuntimePackageContribution,
} from '../extension-contribution-registry-cache'
import { makeExpectBrokerFailure } from './extension-capability-broker-assertions'
import {
  BRANCH_ID,
  BROKER_EXTENSION_ID,
  makeBrokerHarness,
  makeProjectInvocation,
  makeSessionDetail,
  makeSessionTree,
  SESSION_ID,
  TIMESTAMP,
} from './extension-capability-broker-test-utils'
import {
  loadRegistry,
  makeLifecycle,
  makePackage,
  PROJECT_PATH,
} from './extension-contribution-registry-test-utils'

const RUNTIME_BOOTSTRAP_CONTRIBUTION_ID = 'runtime.bootstrap'
const DYNAMIC_TOOL_CONTRIBUTION_ID = 'runtime.tool'
const BRANCH_SCOPE_UNSUPPORTED_ISSUE =
  'Branch-scoped runtime contribution registration is not supported until contribution targets can persist branch scope.'
const expectFailure = makeExpectBrokerFailure(TIMESTAMP)

function makeRuntimeBrokerPackage() {
  return makePackage({
    id: BROKER_EXTENSION_ID,
    name: 'Runtime Broker Extension',
    scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
    capabilities: [
      {
        id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
        methods: [
          OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION,
          OPENWAGGLE_EXTENSION_BROKER.METHOD.UNREGISTER_CONTRIBUTION,
        ],
        scopes: ['project', 'branch'],
      },
      {
        id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
        methods: [OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE],
        scopes: ['project'],
      },
    ],
    contributions: {
      commands: [
        {
          id: RUNTIME_BOOTSTRAP_CONTRIBUTION_ID,
          title: 'Runtime Bootstrap',
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
          methods: [
            OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION,
            OPENWAGGLE_EXTENSION_BROKER.METHOD.UNREGISTER_CONTRIBUTION,
          ],
        },
      ],
      toolRenderers: [],
    },
  })
}

function branchScope() {
  return {
    kind: 'branch',
    projectPath: PROJECT_PATH,
    sessionId: SESSION_ID,
    branchId: BRANCH_ID,
  } as const
}

function runtimeToolRegistration() {
  return {
    family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.TOOL_RENDERERS,
    contribution: {
      id: DYNAMIC_TOOL_CONTRIBUTION_ID,
      title: 'Runtime Tool Renderer',
      runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
      execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
      entry: 'dist/runtime-tool.js',
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
    },
  } as const
}

function runtimeToolRegistrationEntry() {
  const registration = runtimeToolRegistration()
  return {
    family: registration.family,
    contribution: {
      ...registration.contribution,
      target: { projectPaths: [PROJECT_PATH] },
    },
  }
}

function registerRuntimeToolInvocation() {
  return makeProjectInvocation({
    contributionId: RUNTIME_BOOTSTRAP_CONTRIBUTION_ID,
    capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
    method: OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION,
    payload: runtimeToolRegistration(),
    scope: branchScope(),
  })
}

function unregisterRuntimeToolInvocation() {
  return makeProjectInvocation({
    contributionId: RUNTIME_BOOTSTRAP_CONTRIBUTION_ID,
    capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
    method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UNREGISTER_CONTRIBUTION,
    payload: {
      family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.TOOL_RENDERERS,
      contributionId: DYNAMIC_TOOL_CONTRIBUTION_ID,
    },
    scope: branchScope(),
  })
}

describe('invokeExtensionCapability runtime branch contribution guards', () => {
  beforeEach(() => {
    clearExtensionContributionRegistryCacheForTests()
  })

  it('rejects branch-scoped dynamic registrations until branch targets are represented', async () => {
    const extensionPackage = makeRuntimeBrokerPackage()
    const lifecycle = makeLifecycle(extensionPackage)

    const result = await makeBrokerHarness({
      packages: [extensionPackage],
      lifecycles: [lifecycle],
      sessionDetail: makeSessionDetail(PROJECT_PATH),
      sessionTree: makeSessionTree(PROJECT_PATH),
    }).run(registerRuntimeToolInvocation())

    expectFailure(result, OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD)
    expect(result).toMatchObject({
      ok: false,
      error: { issues: [BRANCH_SCOPE_UNSUPPORTED_ISSUE] },
    })
  })

  it('rejects branch-scoped unregistration instead of removing wider registrations', async () => {
    const extensionPackage = makeRuntimeBrokerPackage()
    const lifecycle = makeLifecycle(extensionPackage)
    const harness = makeBrokerHarness({
      packages: [extensionPackage],
      lifecycles: [lifecycle],
      sessionDetail: makeSessionDetail(PROJECT_PATH),
      sessionTree: makeSessionTree(PROJECT_PATH),
    })
    registerRuntimePackageContribution({
      extensionPackage,
      registration: runtimeToolRegistrationEntry(),
    })

    const result = await harness.run(unregisterRuntimeToolInvocation())

    expectFailure(result, OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD)
    const registry = await loadRegistry({
      packages: [extensionPackage],
      lifecycles: [lifecycle],
      projectPaths: [PROJECT_PATH],
    })
    expect(registry.entries.map((entry) => entry.contributionId)).toEqual([
      RUNTIME_BOOTSTRAP_CONTRIBUTION_ID,
      DYNAMIC_TOOL_CONTRIBUTION_ID,
    ])
  })
})
