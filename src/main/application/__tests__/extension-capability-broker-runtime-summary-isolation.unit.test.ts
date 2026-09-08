import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import { makeExpectBrokerFailure } from './extension-capability-broker-assertions'
import {
  BROKER_EXTENSION_ID,
  makeBrokerHarness,
  makeProjectInvocation,
  makeSessionDetail,
  TIMESTAMP,
} from './extension-capability-broker-test-utils'
import {
  loadRegistry,
  makeLifecycle,
  makePackage,
  PROJECT_PATH,
} from './extension-contribution-registry-test-utils'

const RUNTIME_BOOTSTRAP_CONTRIBUTION_ID = 'runtime.bootstrap'
const DYNAMIC_SUMMARY_CONTRIBUTION_ID = 'runtime.session-summary'
const SESSION_A_ID = SessionId('session-a')
const SESSION_B_ID = SessionId('session-b')
const expectFailure = makeExpectBrokerFailure(TIMESTAMP)

function makeRuntimeSummaryPackage() {
  return makePackage({
    id: BROKER_EXTENSION_ID,
    name: 'Runtime Summary Extension',
    scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
    capabilities: [
      {
        id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
        methods: [
          OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION,
          OPENWAGGLE_EXTENSION_BROKER.METHOD.UNREGISTER_CONTRIBUTION,
        ],
        scopes: ['session'],
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
      sessionSummarySections: [],
    },
  })
}

function runtimeSummaryRegistration(input: {
  readonly workerCount: number
  readonly targetSessionId?: string
}) {
  return {
    family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SESSION_SUMMARY_SECTIONS,
    contribution: {
      id: DYNAMIC_SUMMARY_CONTRIBUTION_ID,
      title: 'Runtime Session Summary',
      placement: 'coordination',
      rows: [{ id: 'workers', label: 'Workers', count: input.workerCount }],
      ...(input.targetSessionId !== undefined
        ? { target: { sessionIds: [input.targetSessionId] } }
        : {}),
    },
  } as const
}

function registerSummaryInvocation(input: {
  readonly sessionId: string
  readonly workerCount: number
  readonly targetSessionId?: string
}) {
  return makeProjectInvocation({
    contributionId: RUNTIME_BOOTSTRAP_CONTRIBUTION_ID,
    capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
    method: OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION,
    payload: runtimeSummaryRegistration(input),
    scope: { kind: 'session', projectPath: PROJECT_PATH, sessionId: input.sessionId },
  })
}

function unregisterSummaryInvocation(sessionId: string) {
  return makeProjectInvocation({
    contributionId: RUNTIME_BOOTSTRAP_CONTRIBUTION_ID,
    capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
    method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UNREGISTER_CONTRIBUTION,
    payload: {
      family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SESSION_SUMMARY_SECTIONS,
      contributionId: DYNAMIC_SUMMARY_CONTRIBUTION_ID,
    },
    scope: { kind: 'session', projectPath: PROJECT_PATH, sessionId },
  })
}

function sessionDetail(id: SessionDetail['id'], title: string): SessionDetail {
  return { ...makeSessionDetail(PROJECT_PATH), id, title }
}

function setupHarness() {
  const extensionPackage = makeRuntimeSummaryPackage()
  const lifecycle = makeLifecycle(extensionPackage)
  const harness = makeBrokerHarness({
    packages: [extensionPackage],
    lifecycles: [lifecycle],
    sessionDetails: [
      sessionDetail(SESSION_A_ID, 'Session A'),
      sessionDetail(SESSION_B_ID, 'Session B'),
    ],
  })
  return { extensionPackage, lifecycle, harness }
}

async function loadDynamicSummary(
  extensionPackage: ReturnType<typeof makeRuntimeSummaryPackage>,
  lifecycle: ReturnType<typeof makeLifecycle>,
  sessionId: string,
) {
  const registry = await loadRegistry({
    packages: [extensionPackage],
    lifecycles: [lifecycle],
    projectPaths: [PROJECT_PATH],
    sessionId,
  })
  return registry.entries.find((entry) => entry.contributionId === DYNAMIC_SUMMARY_CONTRIBUTION_ID)
}

describe('runtime Session summary contribution isolation', () => {
  it('pins omitted targets to Session A and rejects an attempted Session B target', async () => {
    const { extensionPackage, lifecycle, harness } = setupHarness()

    const registered = await harness.run(
      registerSummaryInvocation({ sessionId: SESSION_A_ID, workerCount: 1 }),
    )
    expect(registered).toMatchObject({
      ok: true,
      value: {
        family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SESSION_SUMMARY_SECTIONS,
        registeredContributionId: DYNAMIC_SUMMARY_CONTRIBUTION_ID,
      },
    })
    expect(await loadDynamicSummary(extensionPackage, lifecycle, SESSION_A_ID)).toMatchObject({
      projectPaths: [PROJECT_PATH],
      sessionId: SESSION_A_ID,
      target: { projectPaths: [PROJECT_PATH], sessionIds: [SESSION_A_ID] },
      sessionSummary: {
        placement: 'coordination',
        rows: [{ id: 'workers', label: 'Workers', count: 1 }],
      },
    })
    expect(await loadDynamicSummary(extensionPackage, lifecycle, SESSION_B_ID)).toBeUndefined()

    const crossSessionRegistration = await harness.run(
      registerSummaryInvocation({
        sessionId: SESSION_A_ID,
        workerCount: 2,
        targetSessionId: SESSION_B_ID,
      }),
    )
    expectFailure(
      crossSessionRegistration,
      OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD,
    )
    expect(crossSessionRegistration).toMatchObject({
      ok: false,
      error: {
        issues: ['Runtime contribution target is outside the invocation session scope.'],
      },
    })
    expect(await loadDynamicSummary(extensionPackage, lifecycle, SESSION_B_ID)).toBeUndefined()
  })

  it('unregisters Session A without removing the same contribution from Session B', async () => {
    const { extensionPackage, lifecycle, harness } = setupHarness()

    await harness.run(registerSummaryInvocation({ sessionId: SESSION_A_ID, workerCount: 1 }))
    await harness.run(registerSummaryInvocation({ sessionId: SESSION_B_ID, workerCount: 2 }))

    const unregistered = await harness.run(unregisterSummaryInvocation(SESSION_A_ID))
    expect(unregistered).toMatchObject({
      ok: true,
      value: {
        unregisteredContributionId: DYNAMIC_SUMMARY_CONTRIBUTION_ID,
        unregistered: true,
      },
    })
    expect(await loadDynamicSummary(extensionPackage, lifecycle, SESSION_A_ID)).toBeUndefined()
    expect(await loadDynamicSummary(extensionPackage, lifecycle, SESSION_B_ID)).toMatchObject({
      projectPaths: [PROJECT_PATH],
      sessionId: SESSION_B_ID,
      target: { projectPaths: [PROJECT_PATH], sessionIds: [SESSION_B_ID] },
      sessionSummary: {
        rows: [{ id: 'workers', label: 'Workers', count: 2 }],
      },
    })
  })
})
