import { randomUUID } from 'node:crypto'
import { isAgentAuthorizationMode } from '@shared/types/agent-authorization'
import { SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import { SESSION_LIFECYCLE_CONTRACT_VERSION } from '@shared/types/session-lifecycle'
import type { SessionOrganizationCommand } from '@shared/types/session-organization'
import * as Effect from 'effect/Effect'
import { cleanupSessionRun } from '../agent/session-cleanup'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { SettingsService } from '../services/settings-service'
import { validateRequiredProjectPath } from '../utils/project-path-validation'
import { clearAgentPhase, clearStreamBuffer, emitRunCompleted } from '../utils/stream-bridge'
import {
  invalid,
  requireArgCount,
  requiredString,
  requireOptionalArgCount,
  validateSessionId,
  validateSessionNodeId,
  validateWorktreePlan,
} from './host-ui-session-operation-validation'
import { dispatchLocalSessionCommand } from './local-session-command-dispatcher'

const TWO_ARGUMENTS = 2
const THREE_ARGUMENTS = 3

export function mutateLocalUiSession(
  command: Extract<
    Parameters<typeof dispatchLocalSessionCommand>[0]['payload'],
    { contract: 'local-ui-v1' }
  >['request']['command'],
) {
  return Effect.gen(function* () {
    const result = yield* dispatchLocalSessionCommand({
      caller: { callerId: 'gui:local-user', workingDirectory: process.cwd() },
      payload: {
        contract: 'local-ui-v1',
        request: { requestId: randomUUID(), command },
      },
    })
    if (result.contract !== 'local-ui-v1') {
      return yield* invalid('Session Host rejected the Local UI mutation.')
    }
    return result.response
  })
}

export function createSession(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireOptionalArgCount(args, 1, TWO_ARGUMENTS)
    const projectPath = yield* requiredString(args[0], 'Project path')
    const normalizedProjectPath = yield* validateRequiredProjectPath(projectPath)
    const worktreePlan = yield* validateWorktreePlan(args[1])
    const settings = yield* (yield* SettingsService).get()
    const environmentMode = worktreePlan?.environmentMode ?? settings.defaultSessionEnvironmentMode
    const result = yield* dispatchLocalSessionCommand({
      caller: { callerId: 'gui:local-user', workingDirectory: normalizedProjectPath },
      payload: {
        contract: 'session-lifecycle-v2',
        request: {
          contractVersion: SESSION_LIFECYCLE_CONTRACT_VERSION,
          requestId: randomUUID(),
          idempotencyKey: randomUUID(),
          command: {
            operation: 'create',
            projectPath: normalizedProjectPath,
            workspace:
              environmentMode === 'worktree'
                ? {
                    mode: 'new-worktree',
                    ...(worktreePlan?.baseRef ? { baseRef: worktreePlan.baseRef } : {}),
                    ...(worktreePlan?.startFromOrigin !== undefined
                      ? { startFromOrigin: worktreePlan.startFromOrigin }
                      : {}),
                  }
                : { mode: 'local' },
          },
        },
      },
    })
    if (
      result.contract !== 'session-lifecycle-v2' ||
      result.response.outcome.effect !== 'created-root'
    ) {
      return yield* invalid('Session Host rejected GUI Session creation.')
    }
    const session = yield* (yield* SessionProjectionRepository).getOptional(
      SessionId(result.response.outcome.sessionId),
    )
    return session ?? (yield* invalid('Created Session projection is missing.'))
  })
}

export function forkSession(args: readonly unknown[], position: 'before' | 'at') {
  return Effect.gen(function* () {
    yield* requireArgCount(args, THREE_ARGUMENTS)
    const sourceSessionId = yield* validateSessionId(args[0])
    yield* requiredString(args[1], 'Session model')
    const targetNodeId = yield* validateSessionNodeId(args[TWO_ARGUMENTS])
    const result = yield* dispatchLocalSessionCommand({
      caller: { callerId: 'gui:local-user', workingDirectory: process.cwd() },
      payload: {
        contract: 'session-lifecycle-v2',
        request: {
          contractVersion: SESSION_LIFECYCLE_CONTRACT_VERSION,
          requestId: randomUUID(),
          idempotencyKey: randomUUID(),
          command: { operation: 'fork', sourceSessionId, targetNodeId, position },
        },
      },
    })
    if (
      result.contract !== 'session-lifecycle-v2' ||
      result.response.outcome.effect !== 'forked-session'
    ) {
      return yield* invalid('Session Host rejected GUI Session fork.')
    }
    const session = yield* (yield* SessionProjectionRepository).getOptional(
      SessionId(result.response.outcome.sessionId),
    )
    if (!session) return yield* invalid('Forked Session projection is missing.')
    return {
      session,
      cancelled: false,
      ...(result.response.outcome.editorText
        ? { editorText: result.response.outcome.editorText }
        : {}),
    }
  })
}

export function organizeSession(
  command: SessionOrganizationCommand,
  expectedEffect: 'session-renamed' | 'session-archived' | 'session-unarchived',
) {
  return Effect.gen(function* () {
    const result = yield* dispatchLocalSessionCommand({
      caller: { callerId: 'gui:local-user', workingDirectory: process.cwd() },
      payload: {
        contract: 'session-control-v2',
        request: {
          contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
          requestId: randomUUID(),
          idempotencyKey: randomUUID(),
          command,
        },
      },
    })
    if (
      result.contract !== 'session-control-v2' ||
      result.response.outcome.effect !== expectedEffect
    ) {
      return yield* invalid('Session Host rejected Session organization.')
    }
  })
}

export function setAuthorizationMode(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireArgCount(args, TWO_ARGUMENTS)
    const sessionId = yield* validateSessionId(args[0])
    const mode = args[1]
    if (mode !== null && !isAgentAuthorizationMode(mode)) {
      return yield* invalid('Session authorization mode is invalid.')
    }
    const result = yield* dispatchLocalSessionCommand({
      caller: { callerId: 'gui:local-user', workingDirectory: process.cwd() },
      payload: {
        contract: 'session-control-v2',
        request: {
          contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
          requestId: randomUUID(),
          idempotencyKey: randomUUID(),
          command: { operation: 'authorization-set', sessionId, authorizationMode: mode },
        },
      },
    })
    if (
      result.contract !== 'session-control-v2' ||
      result.response.outcome.effect !== 'authorization-updated'
    ) {
      return yield* invalid('Session Host rejected Authorization mode update.')
    }
  })
}

export function dismissInterruptedRun(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireArgCount(args, TWO_ARGUMENTS)
    const sessionId = yield* validateSessionId(args[0])
    const runId = yield* requiredString(args[1], 'Run ID')
    yield* mutateLocalUiSession({ operation: 'dismiss-interrupted-run', sessionId, runId })
  })
}

export function deleteSession(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireArgCount(args, 1)
    const sessionId = yield* validateSessionId(args[0])
    yield* mutateLocalUiSession({ operation: 'delete', sessionId })
    yield* Effect.sync(() => {
      clearAgentPhase(sessionId)
      clearStreamBuffer(sessionId)
      cleanupSessionRun(sessionId)
      emitRunCompleted(sessionId)
    })
  })
}
