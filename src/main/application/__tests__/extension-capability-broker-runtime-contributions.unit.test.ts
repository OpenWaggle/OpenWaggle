import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionInvokeInput } from '@shared/types/extension-broker'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearExtensionContributionRegistryCacheForTests,
  registerRuntimePackageContribution,
} from '../extension-contribution-registry-cache'
import { makeExpectBrokerFailure } from './extension-capability-broker-assertions'
import {
  BROKER_EXTENSION_ID,
  makeBrokerHarness,
  makeProjectInvocation,
  TIMESTAMP,
} from './extension-capability-broker-test-utils'
import {
  loadRegistry,
  makeLifecycle,
  makePackage,
  OTHER_PROJECT_PATH,
  PROJECT_PATH,
} from './extension-contribution-registry-test-utils'

const RUNTIME_BOOTSTRAP_CONTRIBUTION_ID = 'runtime.bootstrap'
const DYNAMIC_TOOL_CONTRIBUTION_ID = 'runtime.tool'
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
        scopes: ['project'],
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

function runtimeToolRegistration(input: { readonly targetProjectPath?: string } = {}) {
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
      ...(input.targetProjectPath !== undefined
        ? { target: { projectPaths: [input.targetProjectPath] } }
        : {}),
    },
  } as const
}

function runtimeToolRegistrationEntry(input: { readonly targetProjectPath: string }) {
  const registration = runtimeToolRegistration(input)
  return {
    family: registration.family,
    contribution: registration.contribution,
  }
}

function registerRuntimeToolInvocation(
  input: {
    readonly targetProjectPath?: string
    readonly scope?: ExtensionInvokeInput['scope']
  } = {},
) {
  return makeProjectInvocation({
    contributionId: RUNTIME_BOOTSTRAP_CONTRIBUTION_ID,
    capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
    method: OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION,
    payload: runtimeToolRegistration(input),
    ...(input.scope !== undefined ? { scope: input.scope } : {}),
  })
}

function unregisterRuntimeToolInvocation(
  input: { readonly scope?: ExtensionInvokeInput['scope'] } = {},
) {
  return makeProjectInvocation({
    contributionId: RUNTIME_BOOTSTRAP_CONTRIBUTION_ID,
    capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
    method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UNREGISTER_CONTRIBUTION,
    payload: {
      family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.TOOL_RENDERERS,
      contributionId: DYNAMIC_TOOL_CONTRIBUTION_ID,
    },
    ...(input.scope !== undefined ? { scope: input.scope } : {}),
  })
}

describe('invokeExtensionCapability runtime contribution registration', () => {
  beforeEach(() => {
    clearExtensionContributionRegistryCacheForTests()
  })

  it('registers and unregisters dynamic contributions through the public broker path', async () => {
    const extensionPackage = makeRuntimeBrokerPackage()
    const lifecycle = makeLifecycle(extensionPackage)
    const harness = makeBrokerHarness({
      packages: [extensionPackage],
      lifecycles: [lifecycle],
    })

    const registerResult = await harness.run(registerRuntimeToolInvocation())
    if (!registerResult.ok) {
      throw new Error(`Expected register success, got ${registerResult.error.code}.`)
    }
    expect(registerResult.value).toMatchObject({
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION,
      family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.TOOL_RENDERERS,
      registeredContributionId: DYNAMIC_TOOL_CONTRIBUTION_ID,
    })

    const registeredRegistry = await loadRegistry({
      packages: [extensionPackage],
      lifecycles: [lifecycle],
      projectPaths: [PROJECT_PATH],
    })
    expect(registeredRegistry.entries.map((entry) => entry.contributionId)).toEqual([
      RUNTIME_BOOTSTRAP_CONTRIBUTION_ID,
      DYNAMIC_TOOL_CONTRIBUTION_ID,
    ])

    const dynamicInvocation = await harness.run(
      makeProjectInvocation({
        contributionId: DYNAMIC_TOOL_CONTRIBUTION_ID,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
      }),
    )
    expect(dynamicInvocation).toMatchObject({
      ok: true,
      value: {
        contributionId: DYNAMIC_TOOL_CONTRIBUTION_ID,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
      },
    })

    const unregisterResult = await harness.run(unregisterRuntimeToolInvocation())
    expect(unregisterResult).toMatchObject({
      ok: true,
      value: {
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UNREGISTER_CONTRIBUTION,
        unregisteredContributionId: DYNAMIC_TOOL_CONTRIBUTION_ID,
        unregistered: true,
      },
    })

    const unregisteredRegistry = await loadRegistry({
      packages: [extensionPackage],
      lifecycles: [lifecycle],
      projectPaths: [PROJECT_PATH],
    })
    expect(unregisteredRegistry.entries.map((entry) => entry.contributionId)).toEqual([
      RUNTIME_BOOTSTRAP_CONTRIBUTION_ID,
    ])

    const dynamicInvocationAfterUnregister = await harness.run(
      makeProjectInvocation({
        contributionId: DYNAMIC_TOOL_CONTRIBUTION_ID,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
      }),
    )
    expectFailure(
      dynamicInvocationAfterUnregister,
      OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNKNOWN_CONTRIBUTION,
    )
  })

  it('scopes project invocations to the invocation project', async () => {
    const extensionPackage = makeRuntimeBrokerPackage()
    const lifecycle = makeLifecycle(extensionPackage)
    const harness = makeBrokerHarness({
      packages: [extensionPackage],
      lifecycles: [lifecycle],
    })

    const registerResult = await harness.run(registerRuntimeToolInvocation())
    expect(registerResult).toMatchObject({ ok: true })

    const activeProjectRegistry = await loadRegistry({
      packages: [extensionPackage],
      lifecycles: [lifecycle],
      projectPaths: [PROJECT_PATH],
    })
    expect(activeProjectRegistry.entries.map((entry) => entry.contributionId)).toEqual([
      RUNTIME_BOOTSTRAP_CONTRIBUTION_ID,
      DYNAMIC_TOOL_CONTRIBUTION_ID,
    ])

    const otherProjectRegistry = await loadRegistry({
      packages: [extensionPackage],
      lifecycles: [lifecycle],
      projectPaths: [OTHER_PROJECT_PATH],
    })
    expect(otherProjectRegistry.entries.map((entry) => entry.contributionId)).toEqual([
      RUNTIME_BOOTSTRAP_CONTRIBUTION_ID,
    ])
  })

  it('preserves same-id dynamic registrations across project scopes', async () => {
    const extensionPackage = makeRuntimeBrokerPackage()
    const lifecycle = makeLifecycle(extensionPackage)
    const harness = makeBrokerHarness({
      packages: [extensionPackage],
      lifecycles: [lifecycle],
      currentProjectPath: OTHER_PROJECT_PATH,
    })
    registerRuntimePackageContribution({
      extensionPackage,
      registration: runtimeToolRegistrationEntry({ targetProjectPath: PROJECT_PATH }),
    })

    const registerOtherProject = await harness.run(
      registerRuntimeToolInvocation({
        scope: { kind: 'project', projectPath: OTHER_PROJECT_PATH },
      }),
    )
    expect(registerOtherProject).toMatchObject({ ok: true })

    const activeProjectRegistry = await loadRegistry({
      packages: [extensionPackage],
      lifecycles: [lifecycle],
      projectPaths: [PROJECT_PATH],
    })
    expect(activeProjectRegistry.entries.map((entry) => entry.contributionId)).toEqual([
      RUNTIME_BOOTSTRAP_CONTRIBUTION_ID,
      DYNAMIC_TOOL_CONTRIBUTION_ID,
    ])

    const otherProjectRegistry = await loadRegistry({
      packages: [extensionPackage],
      lifecycles: [lifecycle],
      projectPaths: [OTHER_PROJECT_PATH],
    })
    expect(otherProjectRegistry.entries.map((entry) => entry.contributionId)).toEqual([
      RUNTIME_BOOTSTRAP_CONTRIBUTION_ID,
      DYNAMIC_TOOL_CONTRIBUTION_ID,
    ])
  })
})
