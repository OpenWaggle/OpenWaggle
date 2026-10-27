import { decodeUnknownExactOrThrow, parseJsonUnknown, Schema } from '@shared/schema'
import { THINKING_LEVELS, type ThinkingLevel } from '@shared/types/settings'

/** What a Wake check printed and how it ended, as the Run that it woke reads it. */
export interface HeartbeatWakeCheckReport {
  readonly command: string
  readonly result: 'woke' | 'failed'
  readonly exitCode: number | null
  readonly timedOut: boolean
  readonly stdout: string
  readonly stderr: string
  /** The command printed more than the output cap; the rest was dropped. */
  readonly truncated: boolean
  /** Why the check failed, when it did. */
  readonly failure?: string
}

/**
 * What a Heartbeat Run is told about its task (#388 decision C), snapshotted on the run row when
 * the firing is sent, so it does not depend on bookkeeping that settles afterwards.
 */
export interface HeartbeatRunContext {
  /** This firing's number among the task's started runs, 1-based. */
  readonly runNumber: number
  readonly consecutiveIdleRuns: number
  readonly idlePauseAfter: number
  readonly stopWhen: string | null
  readonly indefinite: boolean
  readonly endsAt: number | null
  readonly maxRuns: number | null
  /** Runs left after this one, when the task has a run limit. */
  readonly remainingRuns: number | null
  /** The task's own model and thinking level, which apply only to its Runs. */
  readonly modelId?: string
  readonly thinkingLevel?: ThinkingLevel
  readonly wakeCheck?: HeartbeatWakeCheckReport
}

const nullableCount = Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.nonNegative()))

const heartbeatRunContextSchema: Schema.Schema<HeartbeatRunContext> = Schema.Struct({
  runNumber: Schema.Number.pipe(Schema.int(), Schema.positive()),
  consecutiveIdleRuns: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  idlePauseAfter: Schema.Number.pipe(Schema.int(), Schema.positive()),
  stopWhen: Schema.NullOr(Schema.String),
  indefinite: Schema.Boolean,
  endsAt: nullableCount,
  maxRuns: nullableCount,
  remainingRuns: nullableCount,
  modelId: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  thinkingLevel: Schema.optional(Schema.Literal(...THINKING_LEVELS)),
  wakeCheck: Schema.optional(
    Schema.Struct({
      command: Schema.String,
      result: Schema.Literal('woke', 'failed'),
      exitCode: Schema.NullOr(Schema.Number.pipe(Schema.int())),
      timedOut: Schema.Boolean,
      stdout: Schema.String,
      stderr: Schema.String,
      truncated: Schema.Boolean,
      failure: Schema.optional(Schema.String),
    }),
  ),
})

export function encodeHeartbeatRunContext(context: HeartbeatRunContext) {
  return JSON.stringify(context)
}

/** Decodes a stored run context; it is Host-authored, so a bad one is an error, not a guess. */
export function decodeHeartbeatRunContext(json: string) {
  return decodeUnknownExactOrThrow(heartbeatRunContextSchema, parseJsonUnknown(json))
}

const MS_PER_SECOND = 1000

function isoTime(epoch: number | null) {
  return epoch === null ? null : new Date(epoch).toISOString()
}

function wakeCheckIdentity(report: HeartbeatWakeCheckReport) {
  return {
    command: report.command,
    result: report.result,
    exitCode: report.exitCode,
    ...(report.timedOut ? { timedOut: true } : {}),
    ...(report.failure ? { failure: report.failure } : {}),
    stdout: report.stdout,
    ...(report.stderr ? { stderr: report.stderr } : {}),
    ...(report.truncated ? { truncated: true } : {}),
  }
}

export const HEARTBEAT_RUN_INSTRUCTION =
  'If stopWhen is met or nothing is left to do, call schedule_update enabled:false and state why; end with outcome done/idle/acted (hive schedule_outcome).'

/** The Heartbeat fields of a Run identity: data the agent reads, never instructions it obeys. */
export function heartbeatRunIdentity(context: HeartbeatRunContext) {
  return {
    runCount: context.runNumber,
    consecutiveIdleRuns: context.consecutiveIdleRuns,
    autoPauseAfterIdleRuns: context.idlePauseAfter,
    stopWhen: context.stopWhen,
    ...(context.indefinite ? { indefinite: true } : {}),
    endsAt: isoTime(context.endsAt),
    maxRuns: context.maxRuns,
    remainingRuns: context.remainingRuns,
    ...(context.wakeCheck ? { wakeCheck: wakeCheckIdentity(context.wakeCheck) } : {}),
    instruction: HEARTBEAT_RUN_INSTRUCTION,
  }
}

/** Seconds, for messages about a timed-out Wake check. */
export function wakeCheckSeconds(ms: number) {
  return Math.round(ms / MS_PER_SECOND)
}
