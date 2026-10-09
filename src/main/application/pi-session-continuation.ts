import { type RunId, type SessionId, SupportedModelId } from '@shared/types/brand'
import { THINKING_LEVELS } from '@shared/types/settings'
import { formatErrorMessage } from '@shared/utils/node-error'
import { clampThinkingLevel } from '@shared/utils/thinking-levels'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import { createLogger } from '../logger'
import type { PiSessionFileSnapshot, PiSessionProjectionState } from '../ports/pi-session-discovery'
import { type ProviderModelCapabilities, ProviderService } from '../ports/provider-service'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import {
  type SessionSettingChange,
  type SessionSettingChangeOptions,
  SessionSettingsRepository,
} from '../ports/session-settings-repository'
import { ThinkingLevelDefaultService } from '../ports/thinking-level-default-service'

const logger = createLogger('pi-session-continuation')

function lookUpModel(reference: string, projectPath: string) {
  return Effect.gen(function* () {
    const providers = yield* Effect.serviceOption(ProviderService)
    if (Option.isNone(providers)) return undefined
    return yield* providers.value.getProviderForModel(reference, projectPath).pipe(
      Effect.map((provider) => provider.models.find((model) => model.id === reference)),
      Effect.orElseSucceed(() => undefined),
    )
  })
}

/**
 * The model `pi --resume` would continue with, when OpenWaggle can run it: the model change
 * before the latest response if it names a virtual model, otherwise the branch's last model.
 */
function continuationModel(snapshot: PiSessionFileSnapshot, projectPath: string) {
  return Effect.gen(function* () {
    const change = snapshot.lastModelChange
    const changed = change ? yield* lookUpModel(change, projectPath) : undefined
    if (change && changed?.virtual) return changed.available ? changed : undefined
    const model = snapshot.lastModel
      ? yield* lookUpModel(snapshot.lastModel, projectPath)
      : undefined
    return model?.available ? model : undefined
  })
}

/**
 * The thinking level `pi --resume` would start with: the branch's last change, otherwise Pi's
 * default for the session's folder (project settings over global ones, then Pi's built-in
 * default), clamped to what the model the Session runs offers.
 */
function continuationThinkingLevel(
  snapshot: PiSessionFileSnapshot,
  model: ProviderModelCapabilities | undefined,
) {
  return Effect.gen(function* () {
    const known = (level: string | undefined) => THINKING_LEVELS.find((known) => known === level)
    const defaults = yield* Effect.serviceOption(ThinkingLevelDefaultService)
    const requested =
      known(snapshot.lastThinkingLevel) ??
      known(snapshot.defaultThinkingLevel) ??
      (Option.isSome(defaults) ? yield* defaults.value.getDefault() : undefined)
    if (!requested || !model) return requested
    return clampThinkingLevel(requested, model.availableThinkingLevels)
  })
}

/**
 * A discovered Pi session continues the way `pi --resume` would (ADR 0051): with the model and
 * thinking level its branch last used, not OpenWaggle's default, and with Pi's default thinking
 * level when the branch never changed it. Applied when OpenWaggle takes in what another program
 * wrote, and only while no Run is active; a model OpenWaggle cannot run keeps the Session's
 * current one rather than leaving it unable to run.
 */
export function continueWithPiSessionSettings(
  sessionId: SessionId,
  state: PiSessionProjectionState,
  snapshot: PiSessionFileSnapshot,
  options: SessionSettingChangeOptions = {},
): Effect.Effect<ContinuationOutcome, never, never> {
  const { projectPath, piEntryNodeIdPrefix } = state
  if (!piEntryNodeIdPrefix || !projectPath) {
    return Effect.succeed<ContinuationOutcome>({ kind: 'applied' })
  }
  return Effect.gen(function* () {
    const settings = yield* Effect.serviceOption(SessionSettingsRepository)
    if (Option.isNone(settings)) return { kind: 'applied' } satisfies ContinuationOutcome
    let outcome: ContinuationOutcome = { kind: 'applied' }
    const note = (change: SessionSettingChange) => {
      if (change.changed || change.code !== 'session_run_active') return
      outcome = {
        kind: 'refused-by-run',
        ...(change.activeRunId ? { runId: change.activeRunId } : {}),
      }
    }
    const continued = yield* continuationModel(snapshot, projectPath)
    if (continued) {
      note(yield* settings.value.setModel(sessionId, SupportedModelId(continued.id), options))
    }
    const projections = yield* Effect.serviceOption(SessionProjectionRepository)
    const current =
      continued || Option.isNone(projections)
        ? undefined
        : (yield* projections.value.getOptional(sessionId))?.executionModel
    const model = continued ?? (current ? yield* lookUpModel(current, projectPath) : undefined)
    const thinkingLevel = yield* continuationThinkingLevel(snapshot, model)
    if (thinkingLevel) {
      note(yield* settings.value.setThinkingLevel(sessionId, thinkingLevel, options))
    }
    return outcome
  }).pipe(
    Effect.catchAllCause((cause) =>
      Effect.sync((): ContinuationOutcome => {
        logger.warn('Could not continue a Pi session with its own model settings', {
          sessionId,
          error: formatErrorMessage(Cause.squash(cause)),
        })
        return { kind: 'applied' }
      }),
    ),
  )
}

/**
 * `refused-by-run`: a Run already holds the Session, so it applies them itself before it reads
 * them. `runId` is that Run; a stopping Run's may be unknown.
 */
export type ContinuationOutcome =
  | { readonly kind: 'applied' }
  | { readonly kind: 'refused-by-run'; readonly runId?: RunId }
