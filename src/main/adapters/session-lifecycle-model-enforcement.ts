import type { ResolvedAgentDefinitionSnapshot } from '@shared/types/agent-definition'
import type { ResolvedSessionExecutionProfile } from '@shared/types/session-lifecycle'
import type { Settings } from '@shared/types/settings'
import {
  type ProviderRestrictedModel,
  resolveModelWithinProviderRestriction,
  resolveProviderRestriction,
} from '@shared/utils/provider-restriction'
import * as Effect from 'effect/Effect'
import { SessionLifecyclePreparationError } from '../errors'
import type { PrepareSessionLifecycleInput } from '../ports/session-lifecycle-preparation-service'
import { validateProjectPath } from '../utils/project-path-validation'
import {
  buildLifecycleExecutionProfile,
  type ParentExecutionSelection,
} from './session-lifecycle-execution-profile'

function modelEnforcementError(operation: string, cause: unknown) {
  return new SessionLifecyclePreparationError({ operation, cause })
}

/** Launch and spawn start a Run at once, so they cannot proceed without a model. */
function requireRunModel(
  command: PrepareSessionLifecycleInput['request']['command'],
  modelId: string,
) {
  const startsRun = command.operation === 'launch' || command.operation === 'spawn'
  if (!startsRun || modelId.trim().length > 0) return Effect.void
  return Effect.fail(
    modelEnforcementError(
      'resolve-model',
      new Error(
        'No model is selected. Pass --model <provider/model>, or choose a model in the OpenWaggle desktop app.',
      ),
    ),
  )
}

/**
 * Resolves a new Session's model, then holds it to the project's provider restrictions (CONTEXT.md,
 * "Provider restriction"): a model the caller named is refused, a derived one resolves again
 * inside them, and a fork's model — the source Session's own — is always derived, never named.
 * Launch and spawn must still end with a model, or the request fails saying how to pick one.
 */
export function resolveSessionModels(input: {
  readonly command: PrepareSessionLifecycleInput['request']['command']
  readonly parent: ParentExecutionSelection | undefined
  readonly definition: ResolvedAgentDefinitionSnapshot | undefined
  /** Pi's global default thinking level, which a new Session starts from. */
  readonly thinkingLevel: ResolvedSessionExecutionProfile['thinkingLevel']
  readonly settings: Settings
  readonly projectPath: string
  readonly projectProviders: Readonly<Record<string, boolean | readonly string[]>> | undefined
}) {
  return Effect.gen(function* () {
    const builtProfile = buildLifecycleExecutionProfile({
      command: input.command,
      defaults: {
        selectedModel: input.settings.selectedModel,
        thinkingLevel: input.thinkingLevel,
      },
      parent: input.parent,
      definition: input.definition,
    })
    // Scopes are keyed by canonical path, but a CLI or MCP caller may pass a symlinked or
    // non-normalized one; match against its real path so a folder scope still covers it.
    const canonicalProjectPath = yield* validateProjectPath(input.projectPath).pipe(
      Effect.map((resolved) => resolved ?? input.projectPath),
      Effect.orElseSucceed(() => input.projectPath),
    )
    const restriction = resolveProviderRestriction({
      projectPath: canonicalProjectPath,
      byPath: input.settings.providerRestrictionsByPath,
      ...(input.projectProviders ? { projectOverride: input.projectProviders } : {}),
      appWide: input.settings.providerRestrictions,
      ...(input.settings.projectPathAliases ? { aliases: input.settings.projectPathAliases } : {}),
    })
    // A fork carries its source Session's resolved snapshot as its definition: this request named
    // none of it, so a model pinned there is derived and resolves again instead of refusing.
    const forking = input.command.operation === 'fork'
    const namedByCaller = !forking && input.command.specialization?.modelId !== undefined
    const namedByDefinition = !forking && input.definition?.model !== undefined
    const resolution: ProviderRestrictedModel = resolveModelWithinProviderRestriction({
      modelId: builtProfile.modelId,
      named: namedByCaller || namedByDefinition,
      restriction,
      enabledModels: input.settings.enabledModels,
    })
    if (resolution.kind === 'refused') {
      return yield* Effect.fail(
        modelEnforcementError('enforce-provider-restriction', new Error(resolution.message)),
      )
    }
    const profile: ResolvedSessionExecutionProfile = {
      ...builtProfile,
      modelId: resolution.modelId,
    }
    yield* requireRunModel(input.command, profile.modelId)
    const forkModelId =
      input.command.operation === 'fork'
        ? yield* enforceForkModel(
            input.parent?.profile.modelId ?? input.settings.selectedModel,
            restriction,
            input.settings.enabledModels,
          )
        : undefined
    return { profile, forkModelId }
  })
}

/** A fork's model is the source Session's own, so it is derived, never named: it resolves again
 * inside the fork's project, and only a project with no allowed enabled model fails the fork. */
function enforceForkModel(
  modelId: string,
  restriction: ReturnType<typeof resolveProviderRestriction>,
  enabledModels: readonly string[],
) {
  return Effect.suspend(() => {
    const resolution: ProviderRestrictedModel = resolveModelWithinProviderRestriction({
      modelId,
      named: false,
      restriction,
      enabledModels,
    })
    return resolution.kind === 'refused'
      ? Effect.fail(
          modelEnforcementError('enforce-provider-restriction', new Error(resolution.message)),
        )
      : Effect.succeed(resolution.modelId)
  })
}
