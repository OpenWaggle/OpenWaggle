import { randomUUID } from 'node:crypto'
import type {
  AutomaticWorktreeRemovalFailure,
  AutomaticWorktreeRemovalRemoved,
  AutomaticWorktreeRemovalRun,
  WorktreeInventoryEntry,
} from '@shared/types/worktree-inventory'
import * as Cause from 'effect/Cause'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Option from 'effect/Option'
import { createLogger } from '../logger'
import { AutomaticWorktreeRemovalLogStore } from '../ports/automatic-worktree-removal-log'
import { WorktreeSpaceService } from '../ports/worktree-space-service'
import { SettingsService } from '../services/settings-service'
import { getSessionHostEventRuntime } from '../session-host/session-host-events'
import { removeHostUiWorktree } from './host-ui-worktree-operation'
import { listWorktreeInventory } from './worktree-inventory'

const logger = createLogger('automatic-worktree-removal')

/** A pass runs at most once a day. */
export const AUTOMATIC_WORKTREE_REMOVAL_INTERVAL_MS = 86_400_000
/** How often the Host checks whether a pass is due, so turning the rule on acts soon. */
export const AUTOMATIC_WORKTREE_REMOVAL_CHECK = Duration.minutes(10)
/** How long a pass waits to measure a worktree before it removes it without a size. */
export const AUTOMATIC_WORKTREE_REMOVAL_MEASURE_TIMEOUT = Duration.minutes(2)
/** The first check waits until the Host has answered its first clients. */
export const AUTOMATIC_WORKTREE_REMOVAL_START_DELAY = Duration.minutes(1)

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

interface PassOutcome {
  readonly removed: AutomaticWorktreeRemovalRemoved[]
  readonly failed: AutomaticWorktreeRemovalFailure[]
}

/**
 * Removes one worktree the pass found due, if a fresh read just before still finds it due: the
 * pass may reach it minutes later, and a Session restored and archived again, a new commit or a
 * failed cleanup since then keeps it.
 */
function removeIfStillDue(entry: WorktreeInventoryEntry, now: () => number, outcome: PassOutcome) {
  return Effect.gen(function* () {
    const space = yield* WorktreeSpaceService
    const measured = yield* space.measure(entry.path).pipe(
      Effect.timeoutOption(AUTOMATIC_WORKTREE_REMOVAL_MEASURE_TIMEOUT),
      Effect.map(Option.getOrNull),
      Effect.catchAll(() => Effect.succeed(null)),
    )
    const reread = yield* Effect.either(listWorktreeInventory(now(), { onlyPath: entry.path }))
    if (reread._tag === 'Left') {
      // One worktree that cannot be read again is a failure of its own, not of the pass.
      outcome.failed.push({
        path: entry.path,
        projectPath: entry.projectPath,
        message: errorMessage(reread.left),
      })
      return
    }
    const fresh = reread.right.entries.find((candidate) => candidate.path === entry.path)
    if (fresh?.automaticRemoval.kind !== 'due') return
    // Removal and its record are one step: a Host stopping meanwhile cannot drop the record.
    yield* Effect.uninterruptible(
      removeHostUiWorktree(fresh.projectPath, { path: fresh.path }).pipe(
        Effect.catchAll((error) =>
          Effect.succeed({ ok: false, code: 'unknown', message: errorMessage(error) } as const),
        ),
        Effect.tap((result) =>
          Effect.sync(() => {
            if (result.ok) {
              outcome.removed.push({
                path: fresh.path,
                projectPath: fresh.projectPath,
                branch: fresh.branch,
                sessionTitles: fresh.sessions.map((session) => session.title),
                reclaimableBytes: measured?.reclaimableBytes ?? null,
              })
            } else {
              outcome.failed.push({
                path: fresh.path,
                projectPath: fresh.projectPath,
                message: result.message,
              })
            }
          }),
        ),
      ),
    )
  })
}

/**
 * One pass of Automatic worktree removal (ADR 0060): remove every worktree the rule finds due,
 * one at a time, each through the same checked removal Settings uses, and record what happened.
 * Null when the rule is off, a pass ran within the last day, or the Host is draining.
 */
export function runAutomaticWorktreeRemovalPass(
  now: () => number = Date.now,
  isDraining: () => boolean = () => false,
) {
  return Effect.gen(function* () {
    if (isDraining()) return null
    const settings = yield* (yield* SettingsService).get()
    const rule = settings.automaticWorktreeRemoval
    if (!rule.enabled) return null
    const log = yield* AutomaticWorktreeRemovalLogStore
    const { lastCheckedAt } = yield* log.read()
    const startedAt = now()
    if (
      lastCheckedAt !== null &&
      startedAt - lastCheckedAt < AUTOMATIC_WORKTREE_REMOVAL_INTERVAL_MS
    ) {
      return null
    }
    const inventory = yield* listWorktreeInventory(startedAt)
    const outcome: PassOutcome = { removed: [], failed: [] }
    /*
     * A pass stopped part-way, by a drain, by the Host shutting down or by a failure, still
     * records what it removed, and keeps the last check time so the next pass finishes the job.
     */
    const record = (checked: boolean) =>
      Effect.gen(function* () {
        const run: AutomaticWorktreeRemovalRun = {
          id: randomUUID(),
          startedAt,
          finishedAt: now(),
          archivedDays: rule.archivedDays,
          removed: outcome.removed,
          failed: outcome.failed,
        }
        yield* log.record(run, { checked })
        return run
      })
    const completed = yield* Effect.gen(function* () {
      for (const entry of inventory.entries) {
        if (isDraining()) return false
        if (entry.automaticRemoval.kind === 'due') yield* removeIfStillDue(entry, now, outcome)
      }
      return true
    }).pipe(
      Effect.onExit((exit) =>
        Exit.isSuccess(exit) ? Effect.void : record(false).pipe(Effect.ignore),
      ),
    )
    const run = yield* record(completed)
    if (run.removed.length > 0 || run.failed.length > 0) {
      logger.info('Automatic worktree removal finished', {
        removed: run.removed.length,
        failed: run.failed.length,
      })
    }
    return run
  })
}

/** The Host's daily Automatic worktree removal, checked every few minutes once it serves clients. */
export const runAutomaticWorktreeRemovalBackground = Effect.forkScoped(
  Effect.sleep(AUTOMATIC_WORKTREE_REMOVAL_START_DELAY).pipe(
    Effect.zipRight(
      Effect.forever(
        runAutomaticWorktreeRemovalPass(Date.now, () =>
          getSessionHostEventRuntime().liveness.isDraining(),
        ).pipe(
          Effect.catchAllCause((cause) =>
            Effect.sync(() => {
              if (Cause.isInterruptedOnly(cause)) return
              logger.warn('Automatic worktree removal failed', { cause: Cause.pretty(cause) })
            }),
          ),
          Effect.zipRight(Effect.sleep(AUTOMATIC_WORKTREE_REMOVAL_CHECK)),
        ),
      ),
    ),
  ),
)
