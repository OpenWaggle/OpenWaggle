import * as Effect from 'effect/Effect'
import {
  durableSessionRunId,
  MAX_RUN_INITIATOR_CHAIN_DEPTH,
  MAX_RUN_INITIATOR_CHAIN_HOPS,
} from '../domain/session-control/root-session-project-reach'

export interface RunReference {
  readonly sessionId: string
  readonly runId: string
}

/** What one Run contributes: its own verdict, and the agent Runs whose verdicts it also needs. */
export interface RunVerdictStep<Verdict> {
  readonly verdict: Verdict
  readonly followRuns: readonly RunReference[]
}

export interface RunInitiatorWalk<Verdict, E> {
  readonly step: (run: RunReference) => Effect.Effect<RunVerdictStep<Verdict>, E>
  readonly combine: (verdicts: readonly Verdict[]) => Verdict
  /** The fail-closed verdict, such as "no reach" or ask-for-approval; no other Run can lift it. */
  readonly failClosed: Verdict
}

type WalkOutcome<Verdict> =
  | { readonly kind: 'exceeded' }
  | {
      readonly kind: 'walked'
      readonly verdict: Verdict
      /** Runs on the longest initiator path back from this Run, itself included. */
      readonly depth: number
      readonly sessionIds: ReadonlySet<string>
    }

const EXCEEDED = { kind: 'exceeded' } as const

function runKey(run: RunReference) {
  return JSON.stringify([run.sessionId, durableSessionRunId(run.runId)])
}

/**
 * Decide a Run from the Runs that started it: each Run's initiator, followed back through other
 * agents' Runs (an adopted Follow-up's author is provenance only and is not followed, per ADR
 * 0044). The whole tree of those Runs may
 * span at most `MAX_RUN_INITIATOR_CHAIN_DEPTH` other Sessions and `MAX_RUN_INITIATOR_CHAIN_HOPS`
 * Runs on its longest path; beyond either, the check fails closed.
 *
 * Each Run is read once and its verdict, depth, and Sessions are shared by every branch that reaches
 * it, so a Run reached along several branches costs linear, not exponential, reads.
 * The result does not depend on which branch reaches a Run first.
 */
export function walkRunInitiators<Verdict, E>(
  walk: RunInitiatorWalk<Verdict, E>,
  run: RunReference,
): Effect.Effect<Verdict, E> {
  const walked = new Map<string, Extract<WalkOutcome<Verdict>, { kind: 'walked' }>>()
  const visit = (current: RunReference, budget: number): Effect.Effect<WalkOutcome<Verdict>, E> => {
    if (budget <= 0) return Effect.succeed(EXCEEDED)
    const key = runKey(current)
    const known = walked.get(key)
    if (known) return Effect.succeed(known.depth > budget ? EXCEEDED : known)
    return Effect.gen(function* () {
      const step = yield* walk.step(current)
      const verdicts = [step.verdict]
      let depth = 1
      const sessionIds = new Set([current.sessionId])
      for (const next of step.verdict === walk.failClosed ? [] : step.followRuns) {
        const outcome = yield* visit(next, budget - 1)
        if (outcome.kind === 'exceeded') return outcome
        verdicts.push(outcome.verdict)
        depth = Math.max(depth, outcome.depth + 1)
        for (const sessionId of outcome.sessionIds) sessionIds.add(sessionId)
        // Fail-closed anywhere decides the whole check; the rest of the tree cannot change it.
        if (outcome.verdict === walk.failClosed) break
      }
      if (sessionIds.size > MAX_RUN_INITIATOR_CHAIN_DEPTH + 1) return EXCEEDED
      const outcome = {
        kind: 'walked',
        verdict: walk.combine(verdicts),
        depth,
        sessionIds,
      } as const
      walked.set(key, outcome)
      return outcome
    })
  }
  return visit(run, MAX_RUN_INITIATOR_CHAIN_HOPS).pipe(
    Effect.map((outcome) => (outcome.kind === 'exceeded' ? walk.failClosed : outcome.verdict)),
  )
}
