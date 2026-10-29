import { randomUUID } from 'node:crypto'
import type {
  AutomaticWorktreeRemovalFailure,
  AutomaticWorktreeRemovalRemoved,
  AutomaticWorktreeRemovalRun,
} from '@shared/types/worktree-inventory'
import * as Cause from 'effect/Cause'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
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
/** The first check waits until the Host has answered its first clients. */
export const AUTOMATIC_WORKTREE_REMOVAL_START_DELAY = Duration.minutes(1)

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
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
    const space = yield* WorktreeSpaceService
    const inventory = yield* listWorktreeInventory(startedAt)
    const removed: AutomaticWorktreeRemovalRemoved[] = []
    const failed: AutomaticWorktreeRemovalFailure[] = []
    for (const entry of inventory.entries) {
      // A draining Host hands over or shuts down; the rest waits for the next pass.
      if (isDraining()) break
      if (entry.automaticRemoval.kind !== 'due') continue
      const measured = yield* space.cached(entry.path)
      const result = yield* removeHostUiWorktree(entry.projectPath, { path: entry.path }).pipe(
        Effect.catchAll((error) =>
          Effect.succeed({ ok: false, code: 'unknown', message: errorMessage(error) } as const),
        ),
      )
      if (result.ok) {
        removed.push({
          path: entry.path,
          projectPath: entry.projectPath,
          branch: entry.branch,
          sessionTitles: entry.sessions.map((session) => session.title),
          reclaimableBytes: measured?.reclaimableBytes ?? null,
        })
      } else {
        failed.push({ path: entry.path, projectPath: entry.projectPath, message: result.message })
      }
    }
    const run: AutomaticWorktreeRemovalRun = {
      id: randomUUID(),
      startedAt,
      finishedAt: now(),
      archivedDays: rule.archivedDays,
      removed,
      failed,
    }
    yield* log.record(run)
    if (removed.length > 0 || failed.length > 0) {
      logger.info('Automatic worktree removal finished', {
        removed: removed.length,
        failed: failed.length,
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
