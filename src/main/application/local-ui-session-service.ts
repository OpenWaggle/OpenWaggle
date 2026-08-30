import { matchBy } from '@diegogbrisa/ts-match'
import { SessionBranchId, SessionId, SessionNodeId, SupportedModelId } from '@shared/types/brand'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
import { SessionControlAttachmentService } from '../ports/session-control-attachment-service'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { SessionRepository } from '../ports/session-repository'
import { publishSessionHostEvent } from '../session-host/session-host-events'
import { reserveSessionTreeMutation } from './active-session-runs'
import { dismissInterruptedAgentRun } from './agent-run-service'
import { navigateAgentSessionTree } from './agent-session-service'

type LocalUiPayload = Extract<LocalSessionCommandPayload, { contract: 'local-ui-v1' }>
type LocalAttachmentsPayload = Extract<
  LocalSessionCommandPayload,
  { contract: 'local-attachments-v1' }
>

function requireLocalUser(caller: LocalSessionCallerIdentity, operation: string) {
  return caller.callerId === 'gui:local-user'
    ? Effect.void
    : Effect.fail(new Error(`${operation} requires the GUI Local-user identity.`))
}

function updateTreeUiState(
  sessionRepository: SessionRepository['Type'],
  sessionId: SessionId,
  command: Extract<LocalUiPayload['request']['command'], { operation: 'update-tree-ui-state' }>,
) {
  if (
    command.patch.expandedNodeIds === undefined &&
    command.patch.branchesSidebarCollapsed === undefined
  ) {
    return Effect.fail(new Error('Session tree UI state patch must include at least one field.'))
  }
  return sessionRepository
    .updateTreeUiState(sessionId, {
      ...(command.patch.expandedNodeIds
        ? { expandedNodeIds: command.patch.expandedNodeIds.map(SessionNodeId) }
        : {}),
      ...(command.patch.branchesSidebarCollapsed !== undefined
        ? { branchesSidebarCollapsed: command.patch.branchesSidebarCollapsed }
        : {}),
    })
    .pipe(Effect.as({ effect: 'tree-ui-state-updated' as const }))
}

function executeLocalUiMutation(command: LocalUiPayload['request']['command']) {
  return Effect.gen(function* () {
    const sessionId = SessionId(command.sessionId)
    const projection = yield* SessionProjectionRepository
    const sessionRepository = yield* SessionRepository
    return yield* matchBy(command, 'operation')
      .with('pin', () =>
        projection.pinSession(sessionId).pipe(Effect.as({ effect: 'pinned' as const })),
      )
      .with('unpin', () =>
        projection.unpinSession(sessionId).pipe(Effect.as({ effect: 'unpinned' as const })),
      )
      .with('move-pin', (move) =>
        projection
          .movePinnedSession({
            sessionId,
            afterSessionId: move.afterSessionId ? SessionId(move.afterSessionId) : null,
            beforeSessionId: move.beforeSessionId ? SessionId(move.beforeSessionId) : null,
          })
          .pipe(Effect.as({ effect: 'pin-moved' as const })),
      )
      .with('dismiss-interrupted-run', ({ runId }) =>
        dismissInterruptedAgentRun({ sessionId, runId }).pipe(
          Effect.as({ effect: 'interrupted-run-dismissed' as const }),
        ),
      )
      .with('navigate-tree', (navigate) =>
        navigateAgentSessionTree({
          sessionId,
          model: SupportedModelId(navigate.model),
          targetNodeId: SessionNodeId(navigate.targetNodeId),
          ...(navigate.options?.summarize !== undefined
            ? { summarize: navigate.options.summarize }
            : {}),
          ...(navigate.options?.customInstructions
            ? { customInstructions: navigate.options.customInstructions }
            : {}),
        }).pipe(Effect.map((navigation) => ({ effect: 'tree-navigated' as const, navigation }))),
      )
      .with('rename-branch', (rename) => {
        const name = rename.name.trim()
        return name
          ? sessionRepository
              .renameBranch(sessionId, SessionBranchId(rename.branchId), name)
              .pipe(Effect.as({ effect: 'branch-renamed' as const }))
          : Effect.fail(new Error('Session branch name cannot be empty.'))
      })
      .with('archive-branch', ({ branchId }) =>
        sessionRepository
          .archiveBranch(sessionId, SessionBranchId(branchId))
          .pipe(Effect.as({ effect: 'branch-archived' as const })),
      )
      .with('restore-branch', ({ branchId }) =>
        sessionRepository
          .restoreBranch(sessionId, SessionBranchId(branchId))
          .pipe(Effect.as({ effect: 'branch-restored' as const })),
      )
      .with('update-tree-ui-state', (update) =>
        updateTreeUiState(sessionRepository, sessionId, update),
      )
      .with('delete', () =>
        Effect.acquireUseRelease(
          Effect.try({
            try: () => reserveSessionTreeMutation(sessionId),
            catch: () => new Error('Stop the active Run before deleting this Hive Session.'),
          }),
          () => projection.delete(sessionId),
          (reservation) => Effect.sync(reservation.release),
        ).pipe(Effect.as({ effect: 'session-deleted' as const })),
      )
      .exhaustive()
  })
}

export function executeLocalUiSessionCommand(input: {
  readonly caller: LocalSessionCallerIdentity
  readonly payload: LocalUiPayload
}) {
  return Effect.gen(function* () {
    yield* requireLocalUser(input.caller, 'Local UI commands')
    const outcome = yield* executeLocalUiMutation(input.payload.request.command)
    const sessionId = input.payload.request.command.sessionId
    publishSessionHostEvent({
      kind: 'session-list-changed',
      sessionId,
      change: outcome.effect === 'session-deleted' ? 'deleted' : 'updated',
    })
    return {
      contract: 'local-ui-v1',
      response: {
        requestId: input.payload.request.requestId,
        effect: outcome.effect,
        sessionId,
        ...('navigation' in outcome ? { navigation: outcome.navigation } : {}),
      },
    } as const
  })
}

export function prepareLocalGuiAttachments(input: {
  readonly caller: LocalSessionCallerIdentity
  readonly payload: LocalAttachmentsPayload
}) {
  return Effect.gen(function* () {
    yield* requireLocalUser(input.caller, 'Local attachment preparation')
    if (!input.caller.workingDirectory) {
      return yield* Effect.fail(new Error('Attachment preparation requires a working directory.'))
    }
    const service = yield* SessionControlAttachmentService
    const attachments = yield* service.prepare({
      baseDirectory: input.caller.workingDirectory,
      entries: input.payload.request.entries,
      ownerCallerId: input.caller.callerId,
      requestId: input.payload.request.requestId,
    })
    return {
      contract: 'local-attachments-v1',
      response: { requestId: input.payload.request.requestId, attachments },
    } as const
  })
}
