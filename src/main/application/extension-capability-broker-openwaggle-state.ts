import { match } from '@diegogbrisa/ts-match'
import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { safeDecodeUnknown } from '@shared/schema'
import { extensionStateReadPayloadSchema } from '@shared/schemas/extension-broker'
import { SessionId } from '@shared/types/brand'
import type {
  ExtensionBranchView,
  ExtensionInvokeInput,
  ExtensionModelPrefs,
  ExtensionProjectView,
  ExtensionSessionView,
  ExtensionStateReadPayload,
  ExtensionStateSelectedReadResult,
} from '@shared/types/extension-broker'
import * as Effect from 'effect/Effect'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { SessionRepository } from '../ports/session-repository'
import { SettingsService } from '../services/settings-service'
import { auditedSuccess } from './extension-capability-broker-audit'
import type { BrokerRouteInput } from './extension-capability-broker-openwaggle-common'
import {
  invalidPayload,
  payloadDecodeFailure,
  unsupportedMethod,
} from './extension-capability-broker-openwaggle-common'
import {
  toActiveProjectView,
  toBranchView,
  toExtensionModelPrefs,
  toSessionView,
} from './extension-capability-broker-openwaggle-model'
import { emptyObjectPayload, unsupportedPayloadIssues } from './extension-capability-broker-payload'

const STATE_READ_PAYLOAD_KEYS = new Set(['selector'])

interface OpenWaggleStateSnapshot {
  readonly activeProjectPath: string | null
  readonly currentProject: ExtensionProjectView | null
  readonly currentSession: ExtensionSessionView | null
  readonly currentBranch: ExtensionBranchView | null
  readonly recentProjects: readonly string[]
  readonly modelPreferences: ExtensionModelPrefs
}

function stateReadPayload(input: BrokerRouteInput) {
  const unsupportedIssues = unsupportedPayloadIssues(
    input.invocation.payload,
    STATE_READ_PAYLOAD_KEYS,
  )
  if (unsupportedIssues.length > 0) {
    return { ok: false as const, issues: unsupportedIssues }
  }

  const decoded = safeDecodeUnknown(extensionStateReadPayloadSchema, input.invocation.payload)
  return decoded.success
    ? { ok: true as const, payload: decoded.data }
    : { ok: false as const, issues: decoded.issues }
}

function loadOpenWaggleStateSnapshot(input: BrokerRouteInput) {
  return Effect.gen(function* () {
    const settingsService = yield* SettingsService
    const settings = yield* settingsService.get()
    const projectionRepository = yield* SessionProjectionRepository
    const sessionRepository = yield* SessionRepository
    const session =
      input.invocation.scope.kind === 'session' || input.invocation.scope.kind === 'branch'
        ? yield* projectionRepository.getOptional(SessionId(input.invocation.scope.sessionId))
        : null
    const tree =
      input.invocation.scope.kind === 'branch'
        ? yield* sessionRepository.getTree(SessionId(input.invocation.scope.sessionId))
        : null

    return {
      activeProjectPath: settings.projectPath,
      currentProject: toActiveProjectView(settings),
      currentSession: toSessionView(session),
      currentBranch:
        input.invocation.scope.kind === 'branch'
          ? toBranchView(tree, input.invocation.scope.branchId)
          : null,
      recentProjects: [...settings.recentProjects],
      modelPreferences: toExtensionModelPrefs(settings),
    } satisfies OpenWaggleStateSnapshot
  })
}

function selectedStateReadResult(input: {
  readonly invocation: ExtensionInvokeInput
  readonly payload: ExtensionStateReadPayload
  readonly snapshot: OpenWaggleStateSnapshot
}): ExtensionStateSelectedReadResult {
  const base = {
    extensionId: input.invocation.extensionId,
    contributionId: input.invocation.contributionId,
    capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
    method: OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE,
    scope: input.invocation.scope,
  }

  return match(input.payload.selector)
    .with(OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.CURRENT_PROJECT, (selector) => ({
      ...base,
      selector,
      value: input.snapshot.currentProject,
    }))
    .with(OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.CURRENT_SESSION, (selector) => ({
      ...base,
      selector,
      value: input.snapshot.currentSession,
    }))
    .with(OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.CURRENT_BRANCH, (selector) => ({
      ...base,
      selector,
      value: input.snapshot.currentBranch,
    }))
    .with(OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.RECENT_PROJECTS, (selector) => ({
      ...base,
      selector,
      value: [...input.snapshot.recentProjects],
    }))
    .with(OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.MODEL_PREFERENCES, (selector) => ({
      ...base,
      selector,
      value: input.snapshot.modelPreferences,
    }))
    .exhaustive()
}

function runSelectedStateRead(input: BrokerRouteInput, payload: ExtensionStateReadPayload) {
  return Effect.gen(function* () {
    const snapshot = yield* loadOpenWaggleStateSnapshot(input)
    return yield* auditedSuccess({
      invocation: input.invocation,
      timestamp: input.timestamp,
      value: selectedStateReadResult({ invocation: input.invocation, payload, snapshot }),
    })
  })
}

export function routeStateCapability(input: BrokerRouteInput) {
  if (input.invocation.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE) {
    const decoded = stateReadPayload(input)
    return decoded.ok
      ? runSelectedStateRead(input, decoded.payload)
      : payloadDecodeFailure(input, decoded.issues)
  }

  if (input.invocation.method !== OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_STATE) {
    return unsupportedMethod(input)
  }
  if (!emptyObjectPayload(input.invocation.payload)) {
    return invalidPayload(input)
  }

  return Effect.gen(function* () {
    const snapshot = yield* loadOpenWaggleStateSnapshot(input)
    return yield* auditedSuccess({
      invocation: input.invocation,
      timestamp: input.timestamp,
      value: {
        extensionId: input.invocation.extensionId,
        contributionId: input.invocation.contributionId,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_STATE,
        scope: input.invocation.scope,
        activeProjectPath: snapshot.activeProjectPath,
        currentProject: snapshot.currentProject,
        currentSession: snapshot.currentSession,
        currentBranch: snapshot.currentBranch,
        recentProjects: [...snapshot.recentProjects],
        modelPreferences: snapshot.modelPreferences,
      },
    })
  })
}
