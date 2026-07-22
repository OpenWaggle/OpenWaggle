import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionInvokeInput } from '@shared/types/extension-broker'
import { afterEach, describe, expect, it } from 'vitest'
import { makeExpectBrokerFailure } from './extension-capability-broker-assertions'
import {
  BRANCH_ID,
  BROKER_EXTENSION_ID,
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

const STATE_CONTRIBUTION_ID = 'openwaggle.state.read'
const ACTION_CONTRIBUTION_ID = 'openwaggle.actions.project'
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

function makeOpenWaggleBrokerPackage() {
  return makePackage({
    id: BROKER_EXTENSION_ID,
    name: 'OpenWaggle Broker Extension',
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
        id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.ACTIONS,
        methods: [OPENWAGGLE_EXTENSION_BROKER.METHOD.SELECT_PROJECT],
        scopes: ['app'],
      },
      {
        id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
        methods: [
          OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTINGS,
          OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTINGS,
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
          id: ACTION_CONTRIBUTION_ID,
          title: 'Select Project',
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.ACTIONS,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SELECT_PROJECT,
        },
        {
          id: SETTINGS_CONTRIBUTION_ID,
          title: 'Manage Settings',
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
          methods: [
            OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTINGS,
            OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTINGS,
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

describe('invokeExtensionCapability OpenWaggle capabilities', () => {
  afterEach(async () => {
    const projectPaths = tempProjectPaths
    tempProjectPaths = []
    await Promise.all(
      projectPaths.map((projectPath) => rm(projectPath, { recursive: true, force: true })),
    )
  })

  it('reads selected OpenWaggle state for the authorized scope', async () => {
    const extensionPackage = makeOpenWaggleBrokerPackage()
    const result = await runBroker({
      invocation: makeInvocation({
        contributionId: STATE_CONTRIBUTION_ID,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_STATE,
        scope: {
          kind: 'branch',
          projectPath: PROJECT_PATH,
          sessionId: SESSION_ID,
          branchId: BRANCH_ID,
        },
      }),
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
      sessionDetail: makeSessionDetail(PROJECT_PATH),
      sessionTree: makeSessionTree(PROJECT_PATH),
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_STATE,
        activeProjectPath: PROJECT_PATH,
        currentProject: {
          projectPath: PROJECT_PATH,
          active: true,
        },
        currentSession: {
          sessionId: SESSION_ID,
          title: 'Session',
          projectPath: PROJECT_PATH,
        },
        currentBranch: {
          branchId: BRANCH_ID,
          sessionId: SESSION_ID,
          name: 'main',
          main: true,
          archived: false,
        },
        modelPreferences: {
          selectedModel: '',
          favoriteModels: [],
          enabledModels: [],
          thinkingLevel: 'medium',
        },
      },
      audit: {
        outcome: OPENWAGGLE_EXTENSION_BROKER.OUTCOME.SUCCEEDED,
        timestamp: TIMESTAMP,
      },
    })
  })

  it('routes safe app actions without granting direct store access', async () => {
    const extensionPackage = makeOpenWaggleBrokerPackage()
    const selectedProjectPath = await makeExistingProjectPath()
    const reconciledProjectPaths: string[] = []
    const result = await runBroker({
      invocation: makeInvocation({
        contributionId: ACTION_CONTRIBUTION_ID,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.ACTIONS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SELECT_PROJECT,
        payload: { projectPath: selectedProjectPath },
      }),
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
      currentProjectPath: PROJECT_PATH,
      reconciledProjectPaths,
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.ACTIONS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SELECT_PROJECT,
        previousProjectPath: PROJECT_PATH,
        projectPath: selectedProjectPath,
        recentProjects: [selectedProjectPath],
      },
      audit: {
        outcome: OPENWAGGLE_EXTENSION_BROKER.OUTCOME.SUCCEEDED,
        timestamp: TIMESTAMP,
      },
    })
    expect(reconciledProjectPaths).toEqual([selectedProjectPath])
  })

  it('rejects project selection paths that fail normal project validation', async () => {
    const extensionPackage = makeOpenWaggleBrokerPackage()
    const result = await runBroker({
      invocation: makeInvocation({
        contributionId: ACTION_CONTRIBUTION_ID,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.ACTIONS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SELECT_PROJECT,
        payload: { projectPath: 'relative-project' },
      }),
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
      currentProjectPath: PROJECT_PATH,
    })

    expectFailure(result, OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD)
    expect(result).toMatchObject({
      ok: false,
      error: {
        issues: ['Project path must be absolute.'],
      },
    })
  })

  it('rejects app actions outside app scope', async () => {
    const extensionPackage = makeOpenWaggleBrokerPackage()
    const result = await runBroker({
      invocation: makeInvocation({
        contributionId: ACTION_CONTRIBUTION_ID,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.ACTIONS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SELECT_PROJECT,
        scope: { kind: 'project', projectPath: PROJECT_PATH },
        payload: { projectPath: OTHER_PROJECT_PATH },
      }),
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
    })

    expectFailure(result, OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNDECLARED_SCOPE)
  })

  it('rejects unsupported settings payload keys', async () => {
    const extensionPackage = makeOpenWaggleBrokerPackage()
    const result = await runBroker({
      invocation: makeInvocation({
        contributionId: SETTINGS_CONTRIBUTION_ID,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTINGS,
        payload: { projectPath: OTHER_PROJECT_PATH },
      }),
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
    })

    expectFailure(result, OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD)
  })
})
