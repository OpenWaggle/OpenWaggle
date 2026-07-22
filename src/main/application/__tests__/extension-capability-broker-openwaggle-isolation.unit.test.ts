import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionInvokeInput } from '@shared/types/extension-broker'
import { afterEach, describe, expect, it } from 'vitest'
import { makeExpectBrokerFailure } from './extension-capability-broker-assertions'
import { BROKER_EXTENSION_ID, runBroker, TIMESTAMP } from './extension-capability-broker-test-utils'
import {
  makeLifecycle,
  makePackage,
  PROJECT_PATH,
} from './extension-contribution-registry-test-utils'

const ACTION_CONTRIBUTION_ID = 'openwaggle.actions.run'
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
        id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.ACTIONS,
        methods: [OPENWAGGLE_EXTENSION_BROKER.METHOD.SELECT_PROJECT],
        scopes: ['app'],
      },
      {
        id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
        methods: [OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTINGS],
        scopes: ['app'],
      },
    ],
    contributions: {
      commands: [
        {
          id: ACTION_CONTRIBUTION_ID,
          title: 'Run OpenWaggle action',
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.ACTIONS,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SELECT_PROJECT,
        },
        {
          id: SETTINGS_CONTRIBUTION_ID,
          title: 'Manage OpenWaggle settings',
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTINGS,
        },
      ],
    },
  })
}

function makeInvocation(input: {
  readonly contributionId: string
  readonly capability: string
  readonly method: string
  readonly payload?: unknown
}): ExtensionInvokeInput {
  return {
    extensionId: BROKER_EXTENSION_ID,
    contributionId: input.contributionId,
    capability: input.capability,
    method: input.method,
    scope: { kind: 'app' },
    ...(input.payload !== undefined ? { payload: input.payload } : { payload: {} }),
  }
}

describe('invokeExtensionCapability OpenWaggle isolation guards', () => {
  afterEach(async () => {
    const projectPaths = tempProjectPaths
    tempProjectPaths = []
    await Promise.all(
      projectPaths.map((projectPath) => rm(projectPath, { recursive: true, force: true })),
    )
  })

  it('keeps project selection successful when trusted-main reconciliation fails', async () => {
    const extensionPackage = makeOpenWaggleBrokerPackage()
    const selectedProjectPath = await makeExistingProjectPath()
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
      reconcileFailure: new Error('trusted main reconciliation unavailable'),
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SELECT_PROJECT,
        previousProjectPath: PROJECT_PATH,
        projectPath: selectedProjectPath,
      },
      audit: {
        outcome: OPENWAGGLE_EXTENSION_BROKER.OUTCOME.SUCCEEDED,
        timestamp: TIMESTAMP,
      },
    })
  })

  it('rejects bulk project display name updates with invalid project paths', async () => {
    const extensionPackage = makeOpenWaggleBrokerPackage()
    const result = await runBroker({
      invocation: makeInvocation({
        contributionId: SETTINGS_CONTRIBUTION_ID,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTINGS,
        payload: { projectDisplayNames: { 'relative-project': 'OpenWaggle' } },
      }),
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
    })

    expectFailure(result, OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD)
    expect(result).toMatchObject({
      ok: false,
      error: {
        issues: ['Project path must be absolute.'],
      },
    })
  })
})
