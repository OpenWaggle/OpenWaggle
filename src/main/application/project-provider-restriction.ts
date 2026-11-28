import { parseModelRef } from '@shared/types/llm'
import type { SessionDetail } from '@shared/types/session'
import type { Settings } from '@shared/types/settings'
import {
  type ProviderRestrictionScope,
  type ResolvedProviderRestriction,
  resolveModelWithinProviderRestriction,
  resolveProviderRestriction,
} from '@shared/utils/provider-restriction'
import * as Effect from 'effect/Effect'
import { loadProjectConfigStrict } from '../config/project-config'
import { lastAnsweringModelReference } from '../domain/session-model-fallback'
import { ProviderService } from '../ports/provider-service'
import { SettingsService } from '../services/settings-service'
import { validateProjectPath } from '../utils/project-path-validation'

/**
 * A project's **Provider restriction** (CONTEXT.md) from the app settings and its own settings
 * file. Scopes are keyed by canonical path, but a CLI, MCP or Hive caller may pass a symlinked or
 * non-normalized one, so the project is matched by its real path.
 */
export function projectProviderRestriction(input: {
  readonly settings: Pick<
    Settings,
    'providerRestrictions' | 'providerRestrictionsByPath' | 'projectPathAliases'
  >
  readonly projectPath: string
  readonly projectProviders: ProviderRestrictionScope | undefined
}) {
  return Effect.gen(function* () {
    const canonicalProjectPath = yield* validateProjectPath(input.projectPath).pipe(
      Effect.map((resolved) => resolved ?? input.projectPath),
      Effect.orElseSucceed(() => input.projectPath),
    )
    return resolveProviderRestriction({
      projectPath: canonicalProjectPath,
      byPath: input.settings.providerRestrictionsByPath,
      ...(input.projectProviders ? { projectOverride: input.projectProviders } : {}),
      appWide: input.settings.providerRestrictions,
      ...(input.settings.projectPathAliases ? { aliases: input.settings.projectPathAliases } : {}),
    })
  })
}

/**
 * The restriction of a project whose settings file is read strictly: an unreadable file fails
 * closed, as it does for a new Session, rather than lifting the project's own scope.
 */
export function loadProjectProviderRestriction(settings: Settings, projectPath: string) {
  return Effect.gen(function* () {
    const projectConfig = yield* Effect.tryPromise({
      try: () => loadProjectConfigStrict(projectPath),
      catch: (cause) =>
        new Error("The project's settings file could not be read to check its providers.", {
          cause,
        }),
    })
    return yield* projectProviderRestriction({
      settings,
      projectPath,
      projectProviders: projectConfig.providers,
    })
  })
}

/**
 * A Heartbeat's own model was named by whoever scheduled it, so a provider its project refuses
 * fails the Run. It is checked when the Heartbeat fires, not only when it is saved, because a
 * scope can narrow in between.
 */
export function enforceScheduledTaskModel(input: {
  readonly modelId: string | undefined
  readonly projectPath: string | undefined
  readonly settings: Settings
}) {
  return Effect.gen(function* () {
    const { modelId, projectPath } = input
    if (!modelId || !projectPath) return
    const restriction = yield* loadProjectProviderRestriction(input.settings, projectPath)
    const resolution = resolveModelWithinProviderRestriction({
      modelId,
      named: true,
      restriction,
      enabledModels: input.settings.enabledModels,
    })
    if (resolution.kind === 'refused') {
      return yield* Effect.fail(
        new Error(`This Heartbeat's model is refused. ${resolution.message}`),
      )
    }
  })
}

/** The provider of `modelId` when the restriction refuses it, else null. */
function refusedProvider(modelId: string, restriction: ResolvedProviderRestriction) {
  // Pi resolves a trimmed reference, so the provider it will run is the trimmed one's.
  const provider = parseModelRef(modelId.trim())?.provider
  return provider !== undefined && !restriction.allows(provider) ? provider : null
}

function sessionModelRefusalMessage(model: string, provider: string) {
  return `This Session's model ${JSON.stringify(model)} uses provider ${JSON.stringify(provider)}, which this project's provider restrictions do not allow. Pick a model from an allowed provider to continue.`
}

/**
 * Why a Session in `projectPath` may not switch to or run on `model`, or null when it may. The
 * Session's model was a person's choice, so it counts as named and is refused rather than swapped
 * (ADR 0071). An unreadable project settings file fails closed, as it does for a new Session.
 */
export function sessionModelSwitchRefusal(input: {
  readonly model: string
  readonly projectPath: string | null | undefined
  readonly settings: Settings
}) {
  return Effect.gen(function* () {
    if (!input.projectPath) return null
    const restriction = yield* loadProjectProviderRestriction(input.settings, input.projectPath)
    const provider = refusedProvider(input.model, restriction)
    return provider === null ? null : sessionModelRefusalMessage(input.model, provider)
  })
}

/**
 * Why an existing Session may not run on `model` under its project's restriction, or null when it
 * may. A model gone from the catalog continues on the model that answered the Session last, so
 * that model's provider must be allowed as well.
 */
export function sessionModelProviderRefusal(input: {
  readonly model: string
  readonly session: Pick<SessionDetail, 'messages' | 'projectPath'>
  readonly settings: Settings
}) {
  return Effect.gen(function* () {
    const { projectPath } = input.session
    if (!projectPath) return null
    const restriction = yield* loadProjectProviderRestriction(input.settings, projectPath)
    const provider = refusedProvider(input.model, restriction)
    if (provider !== null) return sessionModelRefusalMessage(input.model, provider)
    const fallback = lastAnsweringModelReference(input.session)
    const fallbackProvider =
      fallback !== undefined && fallback !== input.model
        ? refusedProvider(fallback, restriction)
        : null
    if (fallbackProvider === null) return null
    const providerService = yield* ProviderService
    if (yield* providerService.isKnownModel(input.model, projectPath)) return null
    return `This Session's model ${JSON.stringify(input.model)} is unavailable, and the model it would continue on, ${JSON.stringify(fallback)}, uses provider ${JSON.stringify(fallbackProvider)}, which this project's provider restrictions do not allow. Pick a model from an allowed provider to continue.`
  })
}

/**
 * Fails when the Session's project refuses `model`, for operations outside a Run that call it:
 * manual compaction and a summarizing tree navigation (ADR 0071). A fork, a clone and a plain
 * navigation call no model, and a fork's model is derived, so they never come here.
 */
export function refuseRestrictedSessionModel(
  model: string,
  session: Pick<SessionDetail, 'messages' | 'projectPath'>,
) {
  return Effect.gen(function* () {
    const settings = yield* (yield* SettingsService).get()
    const refusal = yield* sessionModelProviderRefusal({ model, session, settings })
    if (refusal !== null) return yield* Effect.fail(new Error(refusal))
  })
}
