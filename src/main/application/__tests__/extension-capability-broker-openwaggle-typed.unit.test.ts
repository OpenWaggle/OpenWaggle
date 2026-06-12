import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionInvokeInput } from '@shared/types/extension-broker'
import { afterEach, describe, expect, it } from 'vitest'
import { makeExpectBrokerFailure } from './extension-capability-broker-assertions'
import {
  BROKER_EXTENSION_ID,
  makeBrokerHarness,
  makeSessionDetail,
  runBroker,
  SESSION_ID,
  TIMESTAMP,
} from './extension-capability-broker-test-utils'
import {
  makeLifecycle,
  makePackage,
  PROJECT_PATH,
} from './extension-contribution-registry-test-utils'

const STATE_CONTRIBUTION_ID = 'openwaggle.state.read'
const SETTINGS_CONTRIBUTION_ID = 'openwaggle.settings.manage'
const TEMP_PROJECT_PREFIX = 'openwaggle-broker-project-'
const expectFailure = makeExpectBrokerFailure(TIMESTAMP)
let tempProjectPaths: string[] = []

async function makeExistingProjectPath() {
  const projectPath = await mkdtemp(join(tmpdir(), TEMP_PROJECT_PREFIX))
  const canonicalProjectPath = await realpath(projectPath)
  tempProjectPaths.push(canonicalProjectPath)
  return canonicalProjectPath
}

function makeTypedBrokerPackage() {
  return makePackage({
    id: BROKER_EXTENSION_ID,
    name: 'OpenWaggle Typed Broker Extension',
    scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
    capabilities: [
      {
        id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
        methods: [
          OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_STATE,
          OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE,
        ],
        scopes: ['app', 'project', 'session', 'branch'],
      },
      {
        id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
        methods: [
          OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTING,
          OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTING,
        ],
        scopes: ['app', 'project'],
      },
    ],
    contributions: {
      commands: [
        {
          id: STATE_CONTRIBUTION_ID,
          title: 'Read OpenWaggle State',
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
          methods: [
            OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_STATE,
            OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE,
          ],
        },
        {
          id: SETTINGS_CONTRIBUTION_ID,
          title: 'Manage OpenWaggle Settings',
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
          methods: [
            OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTING,
            OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTING,
          ],
        },
      ],
    },
  })
}

function makeInvocation(input: {
  readonly contributionId: string
  readonly capability: string
  readonly method: string
  readonly scope?: ExtensionInvokeInput['scope']
  readonly payload?: unknown
}): ExtensionInvokeInput {
  return {
    extensionId: BROKER_EXTENSION_ID,
    contributionId: input.contributionId,
    capability: input.capability,
    method: input.method,
    scope: input.scope ?? { kind: 'app' },
    ...(input.payload !== undefined ? { payload: input.payload } : { payload: {} }),
  }
}

describe('invokeExtensionCapability typed OpenWaggle capabilities', () => {
  afterEach(async () => {
    const projectPaths = tempProjectPaths
    tempProjectPaths = []
    await Promise.all(
      projectPaths.map((projectPath) => rm(projectPath, { recursive: true, force: true })),
    )
  })

  it('reads one typed OpenWaggle state selector without exposing writable store access', async () => {
    const extensionPackage = makeTypedBrokerPackage()
    const result = await runBroker({
      invocation: makeInvocation({
        contributionId: STATE_CONTRIBUTION_ID,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE,
        scope: {
          kind: 'session',
          projectPath: PROJECT_PATH,
          sessionId: SESSION_ID,
        },
        payload: {
          selector: OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.CURRENT_SESSION,
        },
      }),
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
      sessionDetail: makeSessionDetail(PROJECT_PATH),
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE,
        selector: OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.CURRENT_SESSION,
        value: {
          sessionId: SESSION_ID,
          title: 'Session',
          projectPath: PROJECT_PATH,
        },
      },
      audit: {
        outcome: OPENWAGGLE_EXTENSION_BROKER.OUTCOME.SUCCEEDED,
        timestamp: TIMESTAMP,
      },
    })
  })

  it('rejects typed state selectors when the contribution only declared the legacy state method', async () => {
    const extensionPackage = makePackage({
      id: BROKER_EXTENSION_ID,
      name: 'Legacy State Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      capabilities: [
        {
          id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
          methods: [OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_STATE],
          scopes: ['app'],
        },
      ],
      contributions: {
        commands: [
          {
            id: STATE_CONTRIBUTION_ID,
            title: 'Read OpenWaggle State',
            capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
            method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_STATE,
          },
        ],
      },
    })

    const result = await runBroker({
      invocation: makeInvocation({
        contributionId: STATE_CONTRIBUTION_ID,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE,
        payload: {
          selector: OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.CURRENT_PROJECT,
        },
      }),
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
    })

    expectFailure(result, OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNDECLARED_METHOD)
  })

  it('modifies project display names only through the typed setting capability', async () => {
    const extensionPackage = makeTypedBrokerPackage()
    const selectedProjectPath = await makeExistingProjectPath()
    const harness = makeBrokerHarness({
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
    })

    const updateResult = await harness.run(
      makeInvocation({
        contributionId: SETTINGS_CONTRIBUTION_ID,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTING,
        payload: {
          key: OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.PROJECT_DISPLAY_NAME,
          projectPath: selectedProjectPath,
          value: ' OpenWaggle ',
        },
      }),
    )
    const getResult = await harness.run(
      makeInvocation({
        contributionId: SETTINGS_CONTRIBUTION_ID,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTING,
        payload: {
          key: OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.PROJECT_DISPLAY_NAME,
          projectPath: selectedProjectPath,
        },
      }),
    )

    expect(updateResult).toMatchObject({
      ok: true,
      value: {
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTING,
        setting: {
          key: OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.PROJECT_DISPLAY_NAME,
          projectPath: selectedProjectPath,
          value: 'OpenWaggle',
        },
      },
    })
    expect(getResult).toMatchObject({
      ok: true,
      value: {
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTING,
        setting: {
          key: OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.PROJECT_DISPLAY_NAME,
          projectPath: selectedProjectPath,
          value: 'OpenWaggle',
        },
      },
    })
  })

  it('rejects project paths on global model preference setting payloads', async () => {
    const extensionPackage = makeTypedBrokerPackage()
    const harness = makeBrokerHarness({
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
    })

    const getResult = await harness.run(
      makeInvocation({
        contributionId: SETTINGS_CONTRIBUTION_ID,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTING,
        payload: {
          key: OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.MODEL_PREFERENCES,
          projectPath: PROJECT_PATH,
        },
      }),
    )
    const updateResult = await harness.run(
      makeInvocation({
        contributionId: SETTINGS_CONTRIBUTION_ID,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTING,
        payload: {
          key: OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.MODEL_PREFERENCES,
          projectPath: PROJECT_PATH,
          value: {
            thinkingLevel: 'minimal',
          },
        },
      }),
    )

    expectFailure(getResult, OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD)
    expectFailure(updateResult, OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD)
    expect(getResult).toMatchObject({
      ok: false,
      error: {
        issues: ['Unsupported payload keys: projectPath.'],
      },
    })
    expect(updateResult).toMatchObject({
      ok: false,
      error: {
        issues: ['Unsupported payload keys: projectPath.'],
      },
    })
  })
})
