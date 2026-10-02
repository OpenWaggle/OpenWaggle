import { match } from '@diegogbrisa/ts-match'
import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { safeDecodeUnknown } from '@shared/schema'
import {
  extensionSettingsGetPayloadSchema,
  extensionSettingsUpdatePayloadSchema,
  extensionSettingsUpdateSettingPayloadSchema,
} from '@shared/schemas/extension-broker'
import type {
  ExtensionSettingsGetPayload,
  ExtensionSettingsSelectedValue,
  ExtensionSettingsUpdateSettingPayload,
} from '@shared/types/extension-broker'
import type { Settings, ThinkingLevel } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import { ThinkingLevelDefaultService } from '../ports/thinking-level-default-service'
import { SettingsService } from '../services/settings-service'
import { auditedFailure, auditedSuccess } from './extension-capability-broker-audit'
import type { BrokerRouteInput } from './extension-capability-broker-openwaggle-common'
import {
  invalidPayload,
  payloadDecodeFailure,
  unsupportedMethod,
  validateBrokerProjectPath,
} from './extension-capability-broker-openwaggle-common'
import {
  toExtensionModelPrefs,
  toExtensionSettingsView,
  toModelPreferencesUpdatePatch,
  toProjectDisplayNameUpdatePatch,
  toProjectDisplayNameValue,
  toSettingsUpdatePatch,
} from './extension-capability-broker-openwaggle-model'
import {
  settingsGetPayloadIssues,
  settingsUpdatePayloadIssues,
  settingsUpdateSettingPayloadIssues,
  validateSettingsUpdateProjectDisplayNames,
} from './extension-capability-broker-openwaggle-settings-payload'
import { emptyObjectPayload } from './extension-capability-broker-payload'

/** Pi's global default thinking level, which extensions see and set as `thinkingLevel`. */
function defaultThinkingLevel(settings: Settings) {
  return Effect.flatMap(ThinkingLevelDefaultService, (defaults) =>
    defaults.getDefault(settings.projectPath),
  )
}

function updateDefaultThinkingLevel(level: ThinkingLevel | undefined) {
  if (level === undefined) return Effect.void
  return Effect.flatMap(ThinkingLevelDefaultService, (defaults) => defaults.setDefault(level))
}

function settingsGetPayload(input: BrokerRouteInput) {
  const unsupportedIssues = settingsGetPayloadIssues(input.invocation.payload)
  if (unsupportedIssues.length > 0) {
    return { ok: false as const, issues: unsupportedIssues }
  }

  const decoded = safeDecodeUnknown(extensionSettingsGetPayloadSchema, input.invocation.payload)
  return decoded.success
    ? { ok: true as const, payload: decoded.data }
    : { ok: false as const, issues: decoded.issues }
}

function settingsUpdatePayload(input: BrokerRouteInput) {
  const unsupportedIssues = settingsUpdatePayloadIssues(input.invocation.payload)
  if (unsupportedIssues.length > 0) {
    return { ok: false as const, issues: unsupportedIssues }
  }

  const decoded = safeDecodeUnknown(extensionSettingsUpdatePayloadSchema, input.invocation.payload)
  return decoded.success
    ? { ok: true as const, payload: decoded.data }
    : { ok: false as const, issues: decoded.issues }
}

function settingsUpdateSettingPayload(input: BrokerRouteInput) {
  const unsupportedIssues = settingsUpdateSettingPayloadIssues(input.invocation.payload)
  if (unsupportedIssues.length > 0) {
    return { ok: false as const, issues: unsupportedIssues }
  }

  const decoded = safeDecodeUnknown(
    extensionSettingsUpdateSettingPayloadSchema,
    input.invocation.payload,
  )
  return decoded.success
    ? { ok: true as const, payload: decoded.data }
    : { ok: false as const, issues: decoded.issues }
}

function selectedSettingValue(input: {
  readonly payload: ExtensionSettingsGetPayload
  readonly settings: Settings
  readonly defaultThinkingLevel: ThinkingLevel
}): ExtensionSettingsSelectedValue {
  return match(input.payload)
    .with({ key: OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.MODEL_PREFERENCES }, () => ({
      key: OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.MODEL_PREFERENCES,
      value: toExtensionModelPrefs(input.settings, input.defaultThinkingLevel),
    }))
    .with({ key: OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.PROJECT_DISPLAY_NAME }, (payload) =>
      toProjectDisplayNameValue(input.settings, payload.projectPath),
    )
    .exhaustive()
}

function invalidSettingProjectPath(input: BrokerRouteInput, message: string) {
  return auditedFailure({
    invocation: input.invocation,
    code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD,
    message: 'Invalid project path for extension settings capability.',
    issues: [message],
    timestamp: input.timestamp,
  })
}

function runGetSetting(input: BrokerRouteInput, payload: ExtensionSettingsGetPayload) {
  return Effect.gen(function* () {
    const settingsService = yield* SettingsService
    const settings = yield* settingsService.get()
    if (payload.key === OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.PROJECT_DISPLAY_NAME) {
      const validation = yield* validateBrokerProjectPath(payload.projectPath)
      if (validation._tag === 'invalid') {
        return yield* invalidSettingProjectPath(input, validation.message)
      }

      return yield* auditedSuccess({
        invocation: input.invocation,
        timestamp: input.timestamp,
        value: {
          extensionId: input.invocation.extensionId,
          contributionId: input.invocation.contributionId,
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTING,
          setting: toProjectDisplayNameValue(settings, validation.projectPath),
        },
      })
    }

    return yield* auditedSuccess({
      invocation: input.invocation,
      timestamp: input.timestamp,
      value: {
        extensionId: input.invocation.extensionId,
        contributionId: input.invocation.contributionId,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTING,
        setting: selectedSettingValue({
          payload,
          settings,
          defaultThinkingLevel: yield* defaultThinkingLevel(settings),
        }),
      },
    })
  })
}

function runUpdateSetting(input: BrokerRouteInput, payload: ExtensionSettingsUpdateSettingPayload) {
  return Effect.gen(function* () {
    const settingsService = yield* SettingsService
    const currentSettings = yield* settingsService.get()

    if (payload.key === OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.PROJECT_DISPLAY_NAME) {
      const validation = yield* validateBrokerProjectPath(payload.projectPath)
      if (validation._tag === 'invalid') {
        return yield* invalidSettingProjectPath(input, validation.message)
      }

      yield* settingsService.update(
        toProjectDisplayNameUpdatePatch({
          settings: currentSettings,
          projectPath: validation.projectPath,
          value: payload.value,
        }),
      )
      const settings = yield* settingsService.get()
      return yield* auditedSuccess({
        invocation: input.invocation,
        timestamp: input.timestamp,
        value: {
          extensionId: input.invocation.extensionId,
          contributionId: input.invocation.contributionId,
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTING,
          setting: toProjectDisplayNameValue(settings, validation.projectPath),
        },
      })
    }

    yield* settingsService.update(toModelPreferencesUpdatePatch(payload.value))
    yield* updateDefaultThinkingLevel(payload.value.thinkingLevel)
    const settings = yield* settingsService.get()
    return yield* auditedSuccess({
      invocation: input.invocation,
      timestamp: input.timestamp,
      value: {
        extensionId: input.invocation.extensionId,
        contributionId: input.invocation.contributionId,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTING,
        setting: {
          key: OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.MODEL_PREFERENCES,
          value: toExtensionModelPrefs(settings, yield* defaultThinkingLevel(settings)),
        },
      },
    })
  })
}

function routeSettingsOverview(input: BrokerRouteInput) {
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
        settings: toExtensionSettingsView(settings, yield* defaultThinkingLevel(settings)),
      },
    })
  })
}

function runUpdateSettings(input: BrokerRouteInput) {
  const decoded = settingsUpdatePayload(input)
  if (!decoded.ok) {
    return payloadDecodeFailure(input, decoded.issues)
  }

  return Effect.gen(function* () {
    const settingsService = yield* SettingsService
    const validated = validateSettingsUpdateProjectDisplayNames(decoded.payload)
    if (validated._tag === 'invalid') {
      return yield* invalidSettingProjectPath(input, validated.message)
    }

    yield* settingsService.update(toSettingsUpdatePatch(validated.payload))
    yield* updateDefaultThinkingLevel(validated.payload.thinkingLevel)
    const settings = yield* settingsService.get()
    return yield* auditedSuccess({
      invocation: input.invocation,
      timestamp: input.timestamp,
      value: {
        extensionId: input.invocation.extensionId,
        contributionId: input.invocation.contributionId,
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTINGS,
        settings: toExtensionSettingsView(settings, yield* defaultThinkingLevel(settings)),
      },
    })
  })
}

export function routeSettingsCapability(input: BrokerRouteInput) {
  if (input.invocation.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTINGS) {
    return routeSettingsOverview(input)
  }
  if (input.invocation.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTING) {
    const decoded = settingsGetPayload(input)
    return decoded.ok
      ? runGetSetting(input, decoded.payload)
      : payloadDecodeFailure(input, decoded.issues)
  }
  if (input.invocation.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTING) {
    const decoded = settingsUpdateSettingPayload(input)
    return decoded.ok
      ? runUpdateSetting(input, decoded.payload)
      : payloadDecodeFailure(input, decoded.issues)
  }
  return input.invocation.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTINGS
    ? runUpdateSettings(input)
    : unsupportedMethod(input)
}
