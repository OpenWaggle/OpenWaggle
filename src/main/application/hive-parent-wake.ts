import { randomUUID } from 'node:crypto'
import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlMutationResponse,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import { HIVE_WAKE_NOT_NEEDED } from '../domain/session-control/hive-wake'
import { PiSessionFiles } from '../ports/pi-session-discovery'
import {
  type HiveParentWakeCandidate,
  SessionOrchestrationUpdateRepository,
} from '../ports/session-orchestration-update-repository'
import { SettingsService } from '../services/settings-service'
import type { HiveParentWakeRequest } from './hive-parent-wake-request'
import { executeSessionControlMutation } from './session-control-command-service'
import { publishControlResponse } from './session-control-event-projection'

/**
 * Hive wake. A Worker's result or request for help reaches its parent as an orchestration update.
 * A running parent receives it in that Run; an idle parent used to get it only when someone next
 * sent it a message, so a Queen that ended its turn with "I'll report back when the Workers are
 * done" never did. Now the Host starts a Run on the idle parent, prompted by a Host-authored
 * message rather than a user message (ADR 0030, amended). The wake Run acts for the caller the
 * parent's latest Run acted for, as a Follow-up that caller queued would: that caller's authority
 * is checked again as Follow-up delivery checks it, and the Run keeps only a narrowing Run mode
 * override: it never runs above the live Authorization ceiling of whoever started that Run.
 * When the parent is an agent-made Session, the Workers per parent and Active Workers limits
 * apply as to any Run the Host starts; the person's top-level Queen is never held back by them.
 *
 * This constant is the wake Run's intent text; its prompt is the Pi adapter's Host-authored
 * message (`hive-wake-prompt.ts`), never a user message.
 */
export const HIVE_WAKE_RUN_TEXT = 'Worker updates arrived while this Session was idle.'

/**
 * What the wake may do for the latest Run's caller, resolved by the Session Host
 * (`hive-parent-wake-installer.ts`): why that caller may no longer start a Run here, or the Run
 * mode override the wake Run starts with.
 */
export type HiveWakeAuthority =
  | { readonly blocked: string }
  | { readonly blocked?: undefined; readonly runAuthorizationOverride?: AgentAuthorizationMode }

export type ResolveHiveWakeAuthority<R = never> = (
  candidate: HiveParentWakeCandidate,
) => Effect.Effect<HiveWakeAuthority, unknown, R>

/** Why no Run started; `deferred` means a Run limit was full, so a later settlement retries. */
export type HiveParentWakeOutcome = 'started' | 'not-needed' | 'deferred' | 'refused'

const RUN_LIMIT_REFUSALS: ReadonlySet<string> = new Set([
  'host_run_ceiling_reached',
  'parent_concurrency_limit_reached',
])

/** After the user resumed this Session in the pi CLI, a Host Run would fork its history. */
function piCliWroteLast(piSessionFile: string | null) {
  return Effect.gen(function* () {
    if (!piSessionFile) return false
    const files = yield* Effect.serviceOption(PiSessionFiles)
    if (Option.isNone(files)) return false
    return (yield* files.value.lastPromptOrigin(piSessionFile)) === 'outside'
  })
}

function outcomeOf(response: SessionControlMutationResponse) {
  const { outcome } = response
  if (outcome.effect === 'started-run') return 'started' as const
  if (outcome.effect === 'rejected' && RUN_LIMIT_REFUSALS.has(outcome.code)) {
    return 'deferred' as const
  }
  if (outcome.effect === 'rejected' && outcome.code === HIVE_WAKE_NOT_NEEDED) {
    return 'not-needed' as const
  }
  return 'refused' as const
}

/** Starts a wake Run on the parent when it is idle and holds Worker updates no Run acted on. */
export function wakeIdleParent<R = never>(
  request: HiveParentWakeRequest,
  resolveAuthority: ResolveHiveWakeAuthority<R>,
) {
  return Effect.gen(function* () {
    const repository = yield* SessionOrchestrationUpdateRepository
    if (!repository.parentWakeCandidate) return 'not-needed' as const
    const candidate = yield* repository.parentWakeCandidate(request)
    if (!candidate) return 'not-needed' as const
    if (yield* piCliWroteLast(candidate.piSessionFile)) return 'not-needed' as const
    const authority = yield* resolveAuthority(candidate)
    if (authority.blocked !== undefined) return 'refused' as const
    const settings = yield* SettingsService
    const snapshot = yield* settings.get()
    const key = `hive-wake:${candidate.parentSessionId}:${randomUUID()}`
    const response = yield* executeSessionControlMutation({
      callerId: candidate.callerId,
      hostRunCeiling: snapshot.sessionHostRunCeiling,
      hiveWake: true,
      request: {
        contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
        requestId: key,
        idempotencyKey: key,
        command: {
          operation: 'start',
          sessionId: candidate.parentSessionId,
          ...(authority.runAuthorizationOverride
            ? { runAuthorizationOverride: authority.runAuthorizationOverride }
            : {}),
          input: { text: HIVE_WAKE_RUN_TEXT, attachmentIds: [] },
        },
      },
    })
    publishControlResponse(response)
    return outcomeOf(response)
  })
}
