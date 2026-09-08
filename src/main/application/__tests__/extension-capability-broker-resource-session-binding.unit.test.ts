import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { SessionId } from '@shared/types/brand'
import type { ExtensionInvokeInput } from '@shared/types/extension-broker'
import { describe, expect, it } from 'vitest'
import {
  BROKER_EXTENSION_ID,
  makeBrokerHarness,
  makeSessionDetail,
  SESSION_ID,
} from './extension-capability-broker-test-utils'
import {
  makeLifecycle,
  makePackage,
  PROJECT_PATH,
} from './extension-contribution-registry-test-utils'

const CONTRIBUTION_ID = 'resources.list'

function resourcesPackage() {
  return makePackage({
    id: BROKER_EXTENSION_ID,
    name: 'Resource Reader',
    scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
    capabilities: [
      {
        id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RESOURCES,
        methods: [OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST_RESOURCES],
        scopes: ['session'],
      },
    ],
    contributions: {
      commands: [
        {
          id: CONTRIBUTION_ID,
          title: 'List resources',
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RESOURCES,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST_RESOURCES,
        },
      ],
    },
  })
}

function invocation(sessionId: string): ExtensionInvokeInput {
  return {
    extensionId: BROKER_EXTENSION_ID,
    contributionId: CONTRIBUTION_ID,
    capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RESOURCES,
    method: OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST_RESOURCES,
    scope: { kind: 'session', projectPath: PROJECT_PATH, sessionId },
    payload: {},
  }
}

function harness(otherSession: ReturnType<typeof makeSessionDetail>) {
  const extensionPackage = resourcesPackage()
  return makeBrokerHarness({
    packages: [extensionPackage],
    lifecycles: [makeLifecycle(extensionPackage)],
    sessionDetails: [makeSessionDetail(PROJECT_PATH), otherSession],
  })
}

describe('extension resource Session binding', () => {
  it('rejects a raw invocation that swaps to another current Session in the active project', async () => {
    const otherSession = {
      ...makeSessionDetail(PROJECT_PATH),
      id: SessionId('other-session'),
      title: 'Other Session',
    }

    const result = await harness(otherSession).runRaw(invocation(otherSession.id))

    expect(result).toMatchObject({
      ok: false,
      error: { code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.OUT_OF_SCOPE },
    })
  })

  it('rejects a mounted binding when its invocation swaps to an archived Session', async () => {
    const archivedSession = {
      ...makeSessionDetail(PROJECT_PATH),
      id: SessionId('archived-session'),
      title: 'Archived Session',
      archived: true,
    }

    const result = await harness(archivedSession).runBoundAs(
      invocation(SESSION_ID),
      invocation(archivedSession.id),
    )

    expect(result).toMatchObject({
      ok: false,
      error: { code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.OUT_OF_SCOPE },
    })
  })
})
