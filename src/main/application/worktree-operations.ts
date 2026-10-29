import { randomUUID } from 'node:crypto'
import { decodeUnknownOrThrow } from '@shared/schema'
import {
  automaticWorktreeRemovalRunIdSchema,
  worktreeArchiveAndRemovePayloadSchema,
  worktreePathSchema,
} from '@shared/schemas/worktree-inventory'
import type { GitWorktreeMutationResult } from '@shared/types/git'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import type { WorktreeReclaimableSpace } from '@shared/types/worktree-inventory'
import * as Effect from 'effect/Effect'
import { AutomaticWorktreeRemovalLogStore } from '../ports/automatic-worktree-removal-log'
import { GitWorktreeService } from '../ports/git-worktree-service'
import { WorktreeSpaceService } from '../ports/worktree-space-service'
import { removeHostUiWorktree } from './host-ui-worktree-operation'
import { dispatchNonHostUiLocalSessionCommand } from './local-session-command-dispatcher'
import { createCanonicalizer, gatherWorktreeUsageFacts, usageOfWorktree } from './worktree-usage'

/** The registered linked worktree at `worktreePath`; main checkouts and other folders fail. */
function requireLinkedWorktree(projectPath: string, worktreePath: string) {
  return Effect.gen(function* () {
    const gitWorktrees = yield* GitWorktreeService
    const listed = yield* gitWorktrees.list(projectPath)
    const canonical = createCanonicalizer()
    const target = yield* Effect.promise(() => canonical(worktreePath))
    for (const worktree of listed.worktrees) {
      if (worktree.isMain) continue
      if ((yield* Effect.promise(() => canonical(worktree.path))) === target) {
        return { worktree, canonicalPath: target }
      }
    }
    return yield* Effect.fail(new Error('This worktree is no longer registered.'))
  })
}

/** `worktrees:measure`: Reclaimable space of one registered linked worktree. */
export function measureWorktreeOperation(rawProjectPath: unknown, rawWorktreePath: unknown) {
  return Effect.gen(function* () {
    const projectPath = decodeUnknownOrThrow(worktreePathSchema, rawProjectPath)
    const worktreePath = decodeUnknownOrThrow(worktreePathSchema, rawWorktreePath)
    const { worktree } = yield* requireLinkedWorktree(projectPath, worktreePath)
    const space = yield* WorktreeSpaceService
    const measurement = yield* space.measure(worktree.path)
    return { path: worktreePath, ...measurement } satisfies WorktreeReclaimableSpace
  })
}

/**
 * Archive one Session as the desktop user does from the sidebar. This calls the Session Control
 * dispatcher directly rather than through Host UI, which would route back through this module.
 */
function archiveSession(sessionId: string) {
  return Effect.gen(function* () {
    const result = yield* dispatchNonHostUiLocalSessionCommand({
      caller: { callerId: 'gui:local-user', workingDirectory: process.cwd() },
      payload: {
        contract: 'session-control-v2',
        request: {
          contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
          requestId: randomUUID(),
          idempotencyKey: randomUUID(),
          command: { operation: 'archive', sessionId },
        },
      },
    })
    if (
      result.contract !== 'session-control-v2' ||
      result.response.outcome.effect !== 'session-archived'
    ) {
      return yield* Effect.fail(new Error('The Session Host did not archive a Session.'))
    }
  })
}

function archivedCount(count: number) {
  return `Archived ${String(count)} ${count === 1 ? 'Session' : 'Sessions'}`
}

function refused(message: string): GitWorktreeMutationResult {
  return { ok: false, code: 'worktree-in-use', message }
}

/**
 * `worktrees:archive-and-remove`: archive every Session working in the worktree, then remove it
 * as Settings removal does, which checks every blocker again (ADR 0060). `keepWorktree` stops
 * after archiving. Archiving cannot be undone by this call, but Archived items restores it.
 */
export function archiveAndRemoveWorktreeOperation(rawProjectPath: unknown, rawPayload: unknown) {
  return Effect.gen(function* () {
    const projectPath = decodeUnknownOrThrow(worktreePathSchema, rawProjectPath)
    const payload = decodeUnknownOrThrow(worktreeArchiveAndRemovePayloadSchema, rawPayload)
    const { worktree, canonicalPath } = yield* requireLinkedWorktree(projectPath, payload.path)
    const { facts } = yield* gatherWorktreeUsageFacts([projectPath], [worktree.path])
    const usage = usageOfWorktree(canonicalPath, facts)
    const others = usage.blockers.filter((blocker) => blocker.kind !== 'session')
    if (others.length > 0) {
      return refused(
        `This worktree is in use. ${others.map((blocker) => blocker.message).join(' ')}`,
      )
    }
    const named = new Set(payload.sessionIds)
    if (
      named.size !== usage.sessions.length ||
      usage.sessions.some((session) => !named.has(session.sessionId))
    ) {
      return refused('The Sessions in this worktree changed. Review it again before removing it.')
    }
    const running = usage.sessions.find((session) => session.running)
    if (running) {
      return refused(`The Session “${running.title}” has a Run in this worktree. Stop it first.`)
    }
    let archived = 0
    for (const session of usage.sessions) {
      if (session.archived) continue
      const outcome = yield* Effect.either(archiveSession(session.sessionId))
      if (outcome._tag === 'Left') {
        if (archived === 0) return yield* Effect.fail(outcome.left)
        const reason = outcome.left instanceof Error ? outcome.left.message : String(outcome.left)
        return refused(
          `${archivedCount(archived)}, but “${session.title}” could not be archived: ${reason} The worktree was kept.`,
        )
      }
      archived += 1
    }
    if (payload.keepWorktree) {
      return {
        ok: true,
        path: worktree.path,
        message: `${archivedCount(archived)}. The worktree is kept under Needs a decision.`,
      } satisfies GitWorktreeMutationResult
    }
    // Git's registered path: the payload may spell it another way, even relatively.
    /*
     * Archive & remove never discards changes: its force overrides only Git's lock, so a
     * worktree with uncommitted work is kept, with its Sessions archived, for Needs a decision.
     */
    const result = yield* removeHostUiWorktree(projectPath, {
      path: worktree.path,
      ...(payload.force ? { force: true, lockOnly: true } : {}),
    })
    // The Sessions stay archived; say so rather than report only why the worktree was kept.
    if (result.ok || archived === 0) return result
    return {
      ...result,
      message: `${archivedCount(archived)}, but the worktree was kept: ${result.message}`,
    }
  })
}

/** `worktrees:automatic-removal-log`: what Automatic worktree removal did, newest first. */
export function readAutomaticWorktreeRemovalLogOperation() {
  return Effect.gen(function* () {
    const log = yield* AutomaticWorktreeRemovalLogStore
    return yield* log.read()
  })
}

/** `worktrees:acknowledge-automatic-removal`: the app announced this run once. */
export function acknowledgeAutomaticWorktreeRemovalOperation(rawRunId: unknown) {
  return Effect.gen(function* () {
    const runId = decodeUnknownOrThrow(automaticWorktreeRemovalRunIdSchema, rawRunId)
    const log = yield* AutomaticWorktreeRemovalLogStore
    return yield* log.acknowledge(runId)
  })
}
