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

function refused(message: string): GitWorktreeMutationResult {
  return { ok: false, code: 'worktree-in-use', message }
}

/**
 * `worktrees:archive-and-remove`: archive every Session working in the worktree, then remove it
 * as Settings removal does, which checks every blocker again (ADR 0060). Archiving cannot be
 * undone by this call, but Archived items restores it.
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
    const running = usage.sessions.find((session) => session.running)
    if (running) {
      return refused(`The Session “${running.title}” has a Run in this worktree. Stop it first.`)
    }
    for (const session of usage.sessions) {
      if (session.archived) continue
      yield* archiveSession(session.sessionId)
    }
    return yield* removeHostUiWorktree(projectPath, {
      path: payload.path,
      ...(payload.force ? { force: true } : {}),
    })
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
    yield* log.acknowledge(runId)
  })
}
