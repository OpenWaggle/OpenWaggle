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

function registerRuntimeToolInvocation(input: { readonly targetProjectPath?: string } = {}) {
  return makeProjectInvocation({
    contributionId: RUNTIME_BOOTSTRAP_CONTRIBUTION_ID,
    capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
    method: OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION,
    payload: runtimeToolRegistration(input),
  })
}

function unregisterRuntimeToolInvocation(input: {
  readonly scope?: ExtensionInvokeInput['scope']
}) {
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

describe('invokeExtensionCapability runtime contribution registration guards', () => {
  beforeEach(() => {
    clearExtensionContributionRegistryCacheForTests()
  })

  it('does not unregister dynamic contributions outside the invocation project scope', async () => {
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

    const unregisterOtherProject = await harness.run(
      unregisterRuntimeToolInvocation({
        scope: { kind: 'project', projectPath: OTHER_PROJECT_PATH },
      }),
    )
    expect(unregisterOtherProject).toMatchObject({
      ok: true,
      value: { unregistered: false },
    })

    const activeProjectRegistry = await loadRegistry({
      packages: [extensionPackage],
      lifecycles: [lifecycle],
      projectPaths: [PROJECT_PATH],
    })
    expect(activeProjectRegistry.entries.map((entry) => entry.contributionId)).toEqual([
      RUNTIME_BOOTSTRAP_CONTRIBUTION_ID,
      DYNAMIC_TOOL_CONTRIBUTION_ID,
    ])
  })

  it('rejects dynamic registrations that target another project from project scope', async () => {
    const extensionPackage = makeRuntimeBrokerPackage()
    const lifecycle = makeLifecycle(extensionPackage)

    const result = await makeBrokerHarness({
      packages: [extensionPackage],
      lifecycles: [lifecycle],
    }).run(registerRuntimeToolInvocation({ targetProjectPath: OTHER_PROJECT_PATH }))

    expectFailure(result, OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD)
    expect(result).toMatchObject({
      ok: false,
      error: {
        issues: ['Runtime contribution target is outside the invocation project scope.'],
      },
    })
  })

  it('rejects runtime calls from contributions that do not bind the runtime capability', async () => {
    const extensionPackage = makePackage({
      id: BROKER_EXTENSION_ID,
      name: 'Runtime Broker Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      capabilities: [
        {
          id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
          methods: [OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION],
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
            capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
            method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
          },
        ],
        toolRenderers: [],
      },
    })
    const lifecycle = makeLifecycle(extensionPackage)

    const result = await makeBrokerHarness({
      packages: [extensionPackage],
      lifecycles: [lifecycle],
    }).run(registerRuntimeToolInvocation())

    expectFailure(result, OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNDECLARED_CAPABILITY)
  })

  it('rejects dynamic registrations outside manifest-declared contribution families', async () => {
    const extensionPackage = makePackage({
      id: BROKER_EXTENSION_ID,
      name: 'Runtime Broker Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      capabilities: [
        {
          id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
          methods: [OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION],
          scopes: ['project'],
        },
      ],
      contributions: {
        commands: [
          {
            id: RUNTIME_BOOTSTRAP_CONTRIBUTION_ID,
            title: 'Runtime Bootstrap',
            capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
            method: OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION,
          },
        ],
      },
    })
    const lifecycle = makeLifecycle(extensionPackage)

    const result = await makeBrokerHarness({
      packages: [extensionPackage],
      lifecycles: [lifecycle],
    }).run(registerRuntimeToolInvocation())

    expectFailure(result, OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD)
    expect(result).toMatchObject({
      ok: false,
      error: {
        issues: expect.arrayContaining([
          expect.stringContaining('not declared in the extension manifest'),
        ]),
      },
    })
  })
})
