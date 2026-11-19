import type { Settings } from '@shared/types/settings'
import {
  type ProviderRestrictionScope,
  resolveModelWithinProviderRestriction,
  resolveProviderRestriction,
} from '@shared/utils/provider-restriction'
import * as Effect from 'effect/Effect'
import { loadProjectConfigStrict } from '../config/project-config'
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
