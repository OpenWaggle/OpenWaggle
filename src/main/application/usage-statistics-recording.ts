/**
 * Usage statistics hooks for application and IPC code. They go through the
 * {@link UsageStatisticsRecorder} port, never fail, and do nothing in a runtime without one.
 */
import type { SessionId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import type { SessionControlIntentSnapshot } from '../domain/session-control/message-aggregate'
import type { UsageStatisticsObservation } from '../domain/usage-statistics/usage-statistics-observations'
import {
  UsageStatisticsRecorder,
  type UsageStatisticsRecorderShape,
  type UsageStatisticsRunFinish,
} from '../ports/usage-statistics-recorder'

function withRecorder(use: (recorder: UsageStatisticsRecorderShape) => Effect.Effect<void>) {
  return Effect.serviceOption(UsageStatisticsRecorder).pipe(
    Effect.flatMap((recorder) => (Option.isSome(recorder) ? use(recorder.value) : Effect.void)),
    Effect.catchAllCause(() => Effect.void),
  )
}

/** Records one observation for today. */
export function recordUsageStatisticsObservation(observation: UsageStatisticsObservation) {
  return withRecorder((recorder) => recorder.record(observation))
}

type RunIntent = Pick<
  SessionControlIntentSnapshot,
  'callerId' | 'authorCallerId' | 'waggle' | 'attachmentIds' | 'thinkingLevel'
> &
  Partial<Pick<SessionControlIntentSnapshot, 'runAuthorizationOverride'>>

/** The caller whose request started the Run: its author when someone else re-authorized it. */
function runOriginCallerId(intent: RunIntent) {
  return intent.authorCallerId ?? intent.callerId
}

export function recordRunStartedForUsageStatistics(input: {
  readonly sessionId: SessionId
  readonly runId: string
  readonly intent: RunIntent
  readonly waggle?: boolean
}) {
  return withRecorder((recorder) =>
    recorder.runStarted({
      sessionId: input.sessionId,
      runId: input.runId,
      originCallerId: runOriginCallerId(input.intent),
      waggle: input.waggle ?? input.intent.waggle !== undefined,
      attachments: input.intent.attachmentIds.length > 0,
      runAuthorizationOverride: input.intent.runAuthorizationOverride,
    }),
  )
}

export function recordRunFinishedForUsageStatistics(input: {
  readonly runId: string
  readonly intent: RunIntent
  readonly terminalStatus: UsageStatisticsRunFinish['terminalStatus']
  readonly waggle?: boolean
}) {
  return withRecorder((recorder) =>
    recorder.runFinished({
      runId: input.runId,
      originCallerId: runOriginCallerId(input.intent),
      waggle: input.waggle ?? input.intent.waggle !== undefined,
      thinkingLevel: input.intent.thinkingLevel ?? DEFAULT_SETTINGS.thinkingLevel,
      terminalStatus: input.terminalStatus,
    }),
  )
}
