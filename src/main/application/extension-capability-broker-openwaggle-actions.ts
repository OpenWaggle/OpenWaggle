import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { safeDecodeUnknown } from '@shared/schema'
import { extensionActionSelectProjectPayloadSchema } from '@shared/schemas/extension-broker'
import type { ExtensionActionSelectProjectPayload } from '@shared/types/extension-broker'
import * as Effect from 'effect/Effect'
import { ActiveProjectChangeService } from '../ports/active-project-change-service'
import { AppLogger } from '../services/logger-service'
import { SettingsService } from '../services/settings-service'
import { auditedFailure, auditedSuccess } from './extension-capability-broker-audit'
import {
  type BrokerRouteInput,
  payloadDecodeFailure,
  unsupportedMethod,
  validateBrokerProjectPath,
} from './extension-capability-broker-openwaggle-common'
import { appendRecentProject } from './extension-capability-broker-openwaggle-model'
import { unsupportedPayloadIssues } from './extension-capability-broker-payload'
import { describeTrustedMainActivationCause } from './extension-trusted-main-activation-failure'

const SELECT_PROJECT_PAYLOAD_KEYS = new Set(['projectPath'])

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

function runProjectSelection(
  input: BrokerRouteInput,
  payload: ExtensionActionSelectProjectPayload,
) {
  return Effect.gen(function* () {
    const settingsService = yield* SettingsService
    const current = yield* settingsService.get()
    const validation = yield* validateBrokerProjectPath(payload.projectPath)
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
    yield* reconcileTrustedMainExtensionsSafely(projectPath)

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

function reconcileTrustedMainExtensionsSafely(projectPath: string) {
  return Effect.gen(function* () {
    const projectChanges = yield* ActiveProjectChangeService
    yield* projectChanges.reconcileTrustedMainExtensions(projectPath).pipe(
      Effect.catchAllCause((cause) =>
        Effect.gen(function* () {
          const logger = yield* AppLogger
          yield* logger.warn(
            'extension-trusted-main',
            'Skipped trusted main extension startup after activation failure',
            { error: describeTrustedMainActivationCause(cause) },
          )
        }),
      ),
    )
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
