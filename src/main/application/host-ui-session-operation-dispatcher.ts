import { match } from '@diegogbrisa/ts-match'
import { SupportedModelId } from '@shared/types/brand'
import type { HostBackedGuiChannel } from '@shared/types/host-ui-protocol'
import type { IpcInvokeArgs, IpcInvokeReturn } from '@shared/types/ipc'
import * as Effect from 'effect/Effect'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { SessionRepository } from '../ports/session-repository'
import type { SettingsService } from '../services/settings-service'
import {
  createSession,
  deleteSession,
  dismissInterruptedRun,
  forkSession,
  mutateLocalUiSession,
  organizeSession,
  setAuthorizationMode,
} from './host-ui-session-lifecycle-operations'
import {
  invalid,
  requireArgCount,
  requiredString,
  requireOptionalArgCount,
  validateListLimit,
  validateNavigateTreeOptions,
  validateOptionalNumber,
  validatePinnedSessionMove,
  validateSessionBranchId,
  validateSessionId,
  validateSessionNodeId,
  validateTreeUiStatePatch,
  validateWorkspaceSelection,
} from './host-ui-session-operation-validation'

const TWO_ARGUMENTS = 2
const THREE_ARGUMENTS = 3
const FOUR_ARGUMENTS = 4

export type HostBackedSessionGuiChannel = Extract<HostBackedGuiChannel, `sessions:${string}`>

type SessionOperationServices = SessionProjectionRepository | SessionRepository | SettingsService

function dispatchSessionOperation(channel: HostBackedSessionGuiChannel, args: readonly unknown[]) {
  return match(channel)
    .with('sessions:list-details', () => listSessionDetails(args))
    .with('sessions:get-detail', () => getSessionDetail(args))
    .with('sessions:create', () => createSession(args))
    .with('sessions:fork-to-new', () => forkSession(args, 'before'))
    .with('sessions:clone-to-new', () => forkSession(args, 'at'))
    .with('sessions:dismiss-interrupted-run', () => dismissInterruptedRun(args))
    .with('sessions:delete', () => deleteSession(args))
    .with('sessions:archive', () => organizeFromArgs(args, 'archive'))
    .with('sessions:unarchive', () => organizeFromArgs(args, 'unarchive'))
    .with('sessions:list-archived', () => listArchivedSessions(args))
    .with('sessions:update-title', () => updateSessionTitle(args))
    .with('sessions:set-authorization-mode', () => setAuthorizationMode(args))
    .with('sessions:list', 'sessions:list-archived-branches', (matchedChannel) =>
      listRepositorySessions(matchedChannel, args),
    )
    .with('sessions:get-tree', () => getSessionTree(args))
    .with('sessions:get-workspace', () => getSessionWorkspace(args))
    .with('sessions:navigate-tree', () => navigateSessionTree(args))
    .with('sessions:rename-branch', () => renameSessionBranch(args))
    .with('sessions:archive-branch', 'sessions:restore-branch', (matchedChannel) =>
      setSessionBranchArchived(matchedChannel, args),
    )
    .with('sessions:update-tree-ui-state', () => updateSessionTreeUiState(args))
    .with('sessions:turn-checkpoints:list', () => listTurnCheckpoints(args))
    .with('sessions:turn-diff:get', () => getTurnDiff(args))
    .with('sessions:pins:list', () => listPinnedSessions(args))
    .with('sessions:pins:pin', 'sessions:pins:unpin', (matchedChannel) =>
      setSessionPinned(matchedChannel, args),
    )
    .with('sessions:pins:move', () => movePinnedSession(args))
    .exhaustive()
}

function listSessionDetails(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireOptionalArgCount(args, 0, 1)
    const limit = yield* validateOptionalNumber(args[0], 'Session detail limit')
    return [...(yield* (yield* SessionProjectionRepository).listDetails(limit))]
  })
}

function getSessionDetail(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireArgCount(args, 1)
    return yield* (yield* SessionProjectionRepository).getOptional(
      yield* validateSessionId(args[0]),
    )
  })
}

function organizeFromArgs(args: readonly unknown[], operation: 'archive' | 'unarchive') {
  return Effect.gen(function* () {
    yield* requireArgCount(args, 1)
    const sessionId = yield* validateSessionId(args[0])
    yield* organizeSession(
      { operation, sessionId },
      operation === 'archive' ? 'session-archived' : 'session-unarchived',
    )
  })
}

function listArchivedSessions(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireArgCount(args, 0)
    return [...(yield* (yield* SessionProjectionRepository).listArchived())]
  })
}

function updateSessionTitle(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireArgCount(args, TWO_ARGUMENTS)
    const sessionId = yield* validateSessionId(args[0])
    const title = typeof args[1] === 'string' ? args[1] : yield* invalid('Title must be a string.')
    yield* organizeSession({ operation: 'rename', sessionId, title }, 'session-renamed')
  })
}

function listRepositorySessions(
  channel: 'sessions:list' | 'sessions:list-archived-branches',
  args: readonly unknown[],
) {
  return Effect.gen(function* () {
    yield* requireOptionalArgCount(args, 0, 1)
    const limit = yield* validateListLimit(args[0])
    const repository = yield* SessionRepository
    return [
      ...(channel === 'sessions:list'
        ? yield* repository.list(limit)
        : yield* repository.listArchivedBranches(limit)),
    ]
  })
}

function getSessionTree(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireArgCount(args, 1)
    return yield* (yield* SessionRepository).getTree(yield* validateSessionId(args[0]))
  })
}

function getSessionWorkspace(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireOptionalArgCount(args, 1, TWO_ARGUMENTS)
    const sessionId = yield* validateSessionId(args[0])
    const selection = yield* validateWorkspaceSelection(args[1])
    return yield* (yield* SessionRepository).getWorkspace(sessionId, selection)
  })
}

function navigateSessionTree(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireOptionalArgCount(args, THREE_ARGUMENTS, FOUR_ARGUMENTS)
    const sessionId = yield* validateSessionId(args[0])
    const model = SupportedModelId(yield* requiredString(args[1], 'Session model'))
    const targetNodeId = yield* validateSessionNodeId(args[TWO_ARGUMENTS])
    const options = yield* validateNavigateTreeOptions(args[THREE_ARGUMENTS])
    const response = yield* mutateLocalUiSession({
      operation: 'navigate-tree',
      sessionId,
      model,
      targetNodeId,
      ...(options ? { options } : {}),
    })
    return response.navigation ?? { cancelled: true }
  })
}

function renameSessionBranch(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireArgCount(args, THREE_ARGUMENTS)
    const sessionId = yield* validateSessionId(args[0])
    const branchId = yield* validateSessionBranchId(args[1])
    if (typeof args[TWO_ARGUMENTS] !== 'string') {
      return yield* invalid('Session branch name must be a string.')
    }
    const name = args[TWO_ARGUMENTS].trim()
    if (!name) return yield* invalid('Session branch name must be non-empty.')
    yield* mutateLocalUiSession({ operation: 'rename-branch', sessionId, branchId, name })
  })
}

function setSessionBranchArchived(
  channel: 'sessions:archive-branch' | 'sessions:restore-branch',
  args: readonly unknown[],
) {
  return Effect.gen(function* () {
    yield* requireArgCount(args, TWO_ARGUMENTS)
    const sessionId = yield* validateSessionId(args[0])
    const branchId = yield* validateSessionBranchId(args[1])
    yield* mutateLocalUiSession({
      operation: channel === 'sessions:archive-branch' ? 'archive-branch' : 'restore-branch',
      sessionId,
      branchId,
    })
  })
}

function updateSessionTreeUiState(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireArgCount(args, TWO_ARGUMENTS)
    const sessionId = yield* validateSessionId(args[0])
    const patch = yield* validateTreeUiStatePatch(args[1])
    yield* mutateLocalUiSession({ operation: 'update-tree-ui-state', sessionId, patch })
  })
}

function listTurnCheckpoints(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireArgCount(args, 1)
    return [
      ...(yield* (yield* SessionProjectionRepository).listTurnCheckpoints(
        yield* validateSessionId(args[0]),
      )),
    ]
  })
}

function getTurnDiff(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireArgCount(args, TWO_ARGUMENTS)
    const sessionId = yield* validateSessionId(args[0])
    const turnId = yield* requiredString(args[1], 'Turn ID')
    return yield* (yield* SessionProjectionRepository).getTurnDiff(sessionId, turnId)
  })
}

function listPinnedSessions(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireArgCount(args, 0)
    return [...(yield* (yield* SessionProjectionRepository).listPinnedSessions())]
  })
}

function setSessionPinned(
  channel: 'sessions:pins:pin' | 'sessions:pins:unpin',
  args: readonly unknown[],
) {
  return Effect.gen(function* () {
    yield* requireArgCount(args, 1)
    const sessionId = yield* validateSessionId(args[0])
    return yield* mutateLocalUiSession({
      operation: channel === 'sessions:pins:pin' ? 'pin' : 'unpin',
      sessionId,
    })
  })
}

function movePinnedSession(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireArgCount(args, 1)
    const move = yield* validatePinnedSessionMove(args[0])
    return yield* mutateLocalUiSession({ operation: 'move-pin', ...move })
  })
}

export function isHostBackedSessionGuiChannel(
  channel: HostBackedGuiChannel,
): channel is HostBackedSessionGuiChannel {
  return channel.startsWith('sessions:')
}

export function dispatchHostBackedSessionGuiOperation<C extends HostBackedSessionGuiChannel>(
  channel: C,
  args: IpcInvokeArgs<C>,
): Effect.Effect<IpcInvokeReturn<C>, unknown, SessionOperationServices>
export function dispatchHostBackedSessionGuiOperation(
  channel: HostBackedSessionGuiChannel,
  args: readonly unknown[],
): Effect.Effect<unknown, unknown, SessionOperationServices>
export function dispatchHostBackedSessionGuiOperation(
  channel: HostBackedSessionGuiChannel,
  args: readonly unknown[],
) {
  return dispatchSessionOperation(channel, args)
}
