import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { safeDecodeUnknown } from '@shared/schema'
import {
  extensionActionSelectProjectPayloadSchema,
  extensionSettingsUpdatePayloadSchema,
} from '@shared/schemas/extension-broker'
import { SessionId } from '@shared/types/brand'
import type {
  ExtensionActionSelectProjectPayload,
  ExtensionInvokeInput,
} from '@shared/types/extension-broker'
import * as Effect from 'effect/Effect'
import { ActiveProjectChangeService } from '../ports/active-project-change-service'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { SessionRepository } from '../ports/session-repository'
import { SettingsService } from '../services/settings-service'
import { validateRequiredProjectPath } from '../utils/project-path-validation'
import { auditedFailure, auditedSuccess } from './extension-capability-broker-audit'
import {
  appendRecentProject,
  toActiveProjectView,
  toBranchView,
  toExtensionModelPrefs,
  toExtensionSettingsView,
  toSessionView,
  toSettingsUpdatePatch,
} from './extension-capability-broker-openwaggle-model'
import { emptyObjectPayload, unsupportedPayloadIssues } from './extension-capability-broker-payload'

const SELECT_PROJECT_PAYLOAD_KEYS = new Set(['projectPath'])
const SETTINGS_UPDATE_KEYS = new Set([
  'selectedModel',
  'favoriteModels',
  'enabledModels',
  'thinkingLevel',
  'projectDisplayNames',
])

interface BrokerRouteInput {
  readonly invocation: ExtensionInvokeInput
  readonly timestamp: number
}

type ProjectPathValidationResult =
  | { readonly _tag: 'valid'; readonly projectPath: string }
  | { readonly _tag: 'invalid'; readonly message: string }

function invalidPayload(input: BrokerRouteInput & { readonly issues?: readonly string[] }) {
  return auditedFailure({
    invocation: input.invocation,
    code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD,
    message: `Invalid payload for ${input.invocation.capability}.${input.invocation.method}.`,
    ...(input.issues !== undefined ? { issues: input.issues } : {}),
    timestamp: input.timestamp,
  })
}

function unsupportedMethod(input: BrokerRouteInput) {
  return auditedFailure({
    invocation: input.invocation,
    code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNSUPPORTED_METHOD,
    message: `Method "${input.invocation.method}" is not implemented for capability "${input.invocation.capability}".`,
    timestamp: input.timestamp,
  })
}

function payloadDecodeFailure(input: BrokerRouteInput, issues: readonly string[]) {
  return invalidPayload({ ...input, issues })
}

function selectProjectPayload(input: BrokerRouteInput) {
  const unsupportedIssues = unsupportedPayloadIssues(
    input.invocation.payload,
    SELECT_PROJECT_PAYLOAD_KEYS,
  )
  if (unsupportedIssues.length > 0) {
    return { ok: false as const, issues: unsupportedIssues }
  }

  const decoded = safeDecodeUnknown(
    extensionActionSelectProjectPayloadSchema,
    input.invocation.payload,
  )
  return decoded.success
    ? { ok: true as const, payload: decoded.data }
    : { ok: false as const, issues: decoded.issues }
}

function settingsUpdatePayload(input: BrokerRouteInput) {
  const unsupportedIssues = unsupportedPayloadIssues(input.invocation.payload, SETTINGS_UPDATE_KEYS)
  if (unsupportedIssues.length > 0) {
    return { ok: false as const, issues: unsupportedIssues }
  }

  const decoded = safeDecodeUnknown(extensionSettingsUpdatePayloadSchema, input.invocation.payload)
  return decoded.success
    ? { ok: true as const, payload: decoded.data }
    : { ok: false as const, issues: decoded.issues }
}

function validateSelectionProjectPath(
  projectPath: string,
): Effect.Effect<ProjectPathValidationResult> {
  return validateRequiredProjectPath(projectPath).pipe(
    Effect.map(
      (validatedProjectPath): ProjectPathValidationResult => ({
        _tag: 'valid',
        projectPath: validatedProjectPath,
      }),
    ),
    Effect.catchAll((error) =>
      Effect.succeed<ProjectPathValidationResult>({
        _tag: 'invalid',
        message: error.message,
      }),
    ),
  )
}

export function routeStateCapability(input: BrokerRouteInput) {
  if (input.invocation.method !== OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_STATE) {
    return unsupportedMethod(input)
  }
  if (!emptyObjectPayload(input.invocation.payload)) {
    return invalidPayload(input)
  }

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

    return yield* auditedSuccess({
      invocation: input.invocation,
      timestamp: input.timestamp,
      value: {
        extensionId: input.invocation.extensionId,
        contributionId: input.invocation.contributionId,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_STATE,
        scope: input.invocation.scope,
        activeProjectPath: settings.projectPath,
        currentProject: toActiveProjectView(settings),
        currentSession: toSessionView(session),
        currentBranch:
          input.invocation.scope.kind === 'branch'
            ? toBranchView(tree, input.invocation.scope.branchId)
            : null,
        recentProjects: [...settings.recentProjects],
        modelPreferences: toExtensionModelPrefs(settings),
      },
    })
  })
}

function runProjectSelection(
  input: BrokerRouteInput,
  payload: ExtensionActionSelectProjectPayload,
) {
  return Effect.gen(function* () {
    const settingsService = yield* SettingsService
    const current = yield* settingsService.get()
    const validation = yield* validateSelectionProjectPath(payload.projectPath)
    if (validation._tag === 'invalid') {
      return yield* auditedFailure({
        invocation: input.invocation,
        code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD,
        message: 'Invalid project path for extension project selection.',
        issues: [validation.message],
        timestamp: input.timestamp,
      })
    }

    const projectPath = validation.projectPath
    const recentProjects = appendRecentProject(current.recentProjects, projectPath)
    yield* settingsService.update({ projectPath, recentProjects })
    const projectChanges = yield* ActiveProjectChangeService
    yield* projectChanges.reconcileTrustedMainExtensions(projectPath)

    return yield* auditedSuccess({
      invocation: input.invocation,
      timestamp: input.timestamp,
      value: {
        extensionId: input.invocation.extensionId,
        contributionId: input.invocation.contributionId,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.ACTIONS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SELECT_PROJECT,
        previousProjectPath: current.projectPath,
        projectPath,
        recentProjects,
      },
    })
  })
}

export function routeActionCapability(input: BrokerRouteInput) {
  if (input.invocation.method !== OPENWAGGLE_EXTENSION_BROKER.METHOD.SELECT_PROJECT) {
    return unsupportedMethod(input)
  }
  if (input.invocation.scope.kind !== 'app') {
    return auditedFailure({
      invocation: input.invocation,
      code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.OUT_OF_SCOPE,
      message: 'Selecting a project through the extension SDK requires app scope.',
      timestamp: input.timestamp,
    })
  }

  const decoded = selectProjectPayload(input)
  return decoded.ok
    ? runProjectSelection(input, decoded.payload)
    : payloadDecodeFailure(input, decoded.issues)
}

export function routeSettingsCapability(input: BrokerRouteInput) {
  if (input.invocation.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTINGS) {
    if (!emptyObjectPayload(input.invocation.payload)) {
      return invalidPayload(input)
    }

    return Effect.gen(function* () {
      const settingsService = yield* SettingsService
      const settings = yield* settingsService.get()
      return yield* auditedSuccess({
        invocation: input.invocation,
        timestamp: input.timestamp,
        value: {
          extensionId: input.invocation.extensionId,
          contributionId: input.invocation.contributionId,
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTINGS,
          settings: toExtensionSettingsView(settings),
        },
      })
    })
  }

  if (input.invocation.method !== OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTINGS) {
    return unsupportedMethod(input)
  }

  const decoded = settingsUpdatePayload(input)
  if (!decoded.ok) {
    return payloadDecodeFailure(input, decoded.issues)
  }

  return Effect.gen(function* () {
    const settingsService = yield* SettingsService
    yield* settingsService.update(toSettingsUpdatePatch(decoded.payload))
    const settings = yield* settingsService.get()
    return yield* auditedSuccess({
      invocation: input.invocation,
      timestamp: input.timestamp,
      value: {
        extensionId: input.invocation.extensionId,
        contributionId: input.invocation.contributionId,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTINGS,
        settings: toExtensionSettingsView(settings),
      },
    })
  })
}
