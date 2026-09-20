import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionInvokeInput } from '@shared/types/extension-broker'
import type { SessionDetail, SessionTree } from '@shared/types/session'
import type { SessionResource } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import type { DiscoveredExtensionPackage, ExtensionLifecycleState } from '../../extensions/types'
import type { ExtensionStorageItem } from '../../ports/extension-storage-repository'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { invokeExtensionCapability } from '../extension-capability-broker-service'
import { clearExtensionContributionRegistryCacheForTests } from '../extension-contribution-registry-cache'
import { listExtensionContributionRegistryView } from '../extension-contribution-registry-service'
import type { CapturedLog } from './broker-log-test-utils'
import {
  BROKER_BRANCH_ID,
  BROKER_SESSION_ID,
} from './extension-capability-broker-session-test-utils'
import { makeBrokerLayer } from './extension-capability-broker-test-layer'
import {
  makePackage,
  type makeProjectOverride,
  PROJECT_PATH,
} from './extension-contribution-registry-test-utils'

export const BROKER_EXTENSION_ID = 'broker-extension'
export const BROKER_CONTRIBUTION_ID = 'broker.run'
export const TIMESTAMP = 1234
export const SESSION_ID = BROKER_SESSION_ID
export const BRANCH_ID = BROKER_BRANCH_ID

export type { CapturedLog } from './broker-log-test-utils'
export {
  makeSessionDetail,
  makeSessionTree,
} from './extension-capability-broker-session-test-utils'

export function makeBrokerPackage() {
  return makePackage({
    id: BROKER_EXTENSION_ID,
    name: 'Broker Extension',
    scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
    capabilities: [
      {
        id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
        methods: [OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE],
        scopes: ['app', 'project', 'session', 'branch'],
      },
    ],
    contributions: {
      commands: [
        {
          id: BROKER_CONTRIBUTION_ID,
          title: 'Run Broker',
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
        },
      ],
    },
  })
}

export function makeProjectInvocation(
  input: {
    readonly capability?: string
    readonly method?: string
    readonly contributionId?: string
    readonly payload?: unknown
    readonly scope?: ExtensionInvokeInput['scope']
  } = {},
): ExtensionInvokeInput {
  return {
    extensionId: BROKER_EXTENSION_ID,
    contributionId: input.contributionId ?? BROKER_CONTRIBUTION_ID,
    capability: input.capability ?? OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
    method: input.method ?? OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
    scope: input.scope ?? { kind: 'project', projectPath: PROJECT_PATH },
    ...(input.payload !== undefined ? { payload: input.payload } : { payload: {} }),
  }
}

interface BrokerHarnessInput {
  readonly invocation: ExtensionInvokeInput
  readonly packages?: readonly DiscoveredExtensionPackage[]
  readonly lifecycles?: readonly ExtensionLifecycleState[]
  readonly projectOverrides?: readonly ReturnType<typeof makeProjectOverride>[]
  readonly sessionDetail?: SessionDetail
  readonly sessionDetails?: readonly SessionDetail[]
  readonly sessionTree?: SessionTree
  readonly storageItems?: readonly ExtensionStorageItem[]
  readonly capturedLogs?: CapturedLog[]
  readonly currentProjectPath?: string | null
  readonly reconciledProjectPaths?: string[]
  readonly reconcileFailure?: Error
  readonly resources?: readonly SessionResource[]
  readonly resourceUpserts?: UpsertSessionResourceInput[]
}

export async function runBroker(input: BrokerHarnessInput) {
  const harness = makeBrokerHarness(input)
  return harness.run(input.invocation)
}

export function makeBrokerHarness(input: Omit<BrokerHarnessInput, 'invocation'>) {
  clearExtensionContributionRegistryCacheForTests()
  const capturedLogs = input.capturedLogs ?? []
  const reconciledProjectPaths = input.reconciledProjectPaths ?? []
  const storageItems = [...(input.storageItems ?? [])]
  const resources = [...(input.resources ?? [])]
  const resourceUpserts = input.resourceUpserts ?? []
  const layer = makeBrokerLayer({
    packages: input.packages ?? [],
    lifecycles: input.lifecycles ?? [],
    projectOverrides: input.projectOverrides,
    sessionDetail: input.sessionDetail,
    sessionDetails: input.sessionDetails,
    sessionTree: input.sessionTree,
    storageItems,
    capturedLogs,
    currentProjectPath: input.currentProjectPath ?? PROJECT_PATH,
    reconciledProjectPaths,
    ...(input.reconcileFailure !== undefined ? { reconcileFailure: input.reconcileFailure } : {}),
    resources,
    resourceUpserts,
  })

  function loadInvocationBinding(invocation: ExtensionInvokeInput) {
    const projectPaths = invocation.scope.kind === 'app' ? [] : [invocation.scope.projectPath]
    const sessionId =
      invocation.scope.kind === 'session' || invocation.scope.kind === 'branch'
        ? invocation.scope.sessionId
        : undefined
    return listExtensionContributionRegistryView({
      projectPaths,
      ...(sessionId !== undefined ? { sessionId } : {}),
    }).pipe(
      Effect.map(
        (registry) =>
          registry.entries.find(
            (candidate) =>
              candidate.extensionId === invocation.extensionId &&
              candidate.contributionId === invocation.contributionId,
          )?.invocationBinding,
      ),
    )
  }

  function runWithBinding(invocation: ExtensionInvokeInput, invocationBinding: string | undefined) {
    return Effect.runPromise(
      invokeExtensionCapability(invocation, {
        now: () => TIMESTAMP,
        invocationBinding,
      }).pipe(Effect.provide(layer)),
    )
  }

  function runBound(invocation: ExtensionInvokeInput) {
    return Effect.runPromise(loadInvocationBinding(invocation).pipe(Effect.provide(layer))).then(
      (invocationBinding) => runWithBinding(invocation, invocationBinding),
    )
  }

  return {
    run: runBound,
    runBoundAs: async (
      bindingInvocation: ExtensionInvokeInput,
      invocation: ExtensionInvokeInput,
    ) => {
      const invocationBinding = await Effect.runPromise(
        loadInvocationBinding(bindingInvocation).pipe(Effect.provide(layer)),
      )
      return runWithBinding(invocation, invocationBinding)
    },
    runRaw: (invocation: ExtensionInvokeInput) =>
      Effect.runPromise(
        invokeExtensionCapability(invocation, { now: () => TIMESTAMP }).pipe(Effect.provide(layer)),
      ),
    storageItems: () => storageItems.map((item) => item),
    reconciledProjectPaths: () => reconciledProjectPaths.map((projectPath) => projectPath),
    resources: () => resources.map((resource) => resource),
    resourceUpserts: () => resourceUpserts.map((resource) => resource),
  }
}
