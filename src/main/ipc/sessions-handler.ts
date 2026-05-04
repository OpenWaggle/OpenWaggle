import { ConversationId, SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type {
  SessionNavigateTreeOptions,
  SessionTreeUiStatePatch,
  SessionWorkspaceSelection,
} from '@shared/types/session'
import { isRecord } from '@shared/utils/validation'
import * as Effect from 'effect/Effect'
import { navigateAgentSessionTree } from '../application/agent-session-service'
import { SessionRepository } from '../ports/session-repository'
import { typedHandle } from './typed-ipc'

const MAX_SESSION_LIST_LIMIT = 500

function validateListLimit(limit: unknown): Effect.Effect<number | undefined, Error> {
  if (limit === undefined) {
    return Effect.succeed(undefined)
  }
  if (
    typeof limit !== 'number' ||
    !Number.isInteger(limit) ||
    limit <= 0 ||
    limit > MAX_SESSION_LIST_LIMIT
  ) {
    return Effect.fail(
      new Error(
        `Session list limit must be an integer from 1 to ${String(MAX_SESSION_LIST_LIMIT)}.`,
      ),
    )
  }
  return Effect.succeed(limit)
}

function validateSessionId(sessionId: unknown): Effect.Effect<SessionId, Error> {
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    return Effect.fail(new Error('Session ID must be a non-empty string.'))
  }
  return Effect.succeed(SessionId(sessionId))
}

function validateSessionNodeId(nodeId: unknown): Effect.Effect<SessionNodeId, Error> {
  if (typeof nodeId !== 'string' || nodeId.trim().length === 0) {
    return Effect.fail(new Error('Session node ID must be a non-empty string.'))
  }
  return Effect.succeed(SessionNodeId(nodeId))
}

function validateOptionalSessionNodeId(
  nodeId: unknown,
): Effect.Effect<SessionNodeId | null | undefined, Error> {
  if (nodeId === null || nodeId === undefined) {
    return Effect.succeed(nodeId)
  }
  return validateSessionNodeId(nodeId)
}

function validateOptionalSessionBranchId(
  branchId: unknown,
): Effect.Effect<SessionBranchId | null | undefined, Error> {
  if (branchId === null || branchId === undefined) {
    return Effect.succeed(branchId)
  }
  if (typeof branchId !== 'string' || branchId.trim().length === 0) {
    return Effect.fail(new Error('Session branch ID must be a non-empty string.'))
  }
  return Effect.succeed(SessionBranchId(branchId))
}

function validateBranchName(name: unknown): Effect.Effect<string, Error> {
  if (typeof name !== 'string') {
    return Effect.fail(new Error('Session branch name must be a string.'))
  }

  const trimmed = name.trim()
  if (!trimmed) {
    return Effect.fail(new Error('Session branch name must be non-empty.'))
  }

  return Effect.succeed(trimmed)
}

function validateWorkspaceSelection(
  selection: SessionWorkspaceSelection | undefined,
): Effect.Effect<SessionWorkspaceSelection | undefined, Error> {
  if (selection === undefined) {
    return Effect.succeed(undefined)
  }

  if (!isRecord(selection)) {
    return Effect.fail(new Error('Session workspace selection must be an object.'))
  }

  return Effect.gen(function* () {
    const branchId = yield* validateOptionalSessionBranchId(selection.branchId)
    const nodeId = yield* validateOptionalSessionNodeId(selection.nodeId)
    return {
      branchId,
      nodeId,
    }
  })
}

function validateTreeUiStatePatch(
  patch: SessionTreeUiStatePatch,
): Effect.Effect<SessionTreeUiStatePatch, Error> {
  if (!isRecord(patch)) {
    return Effect.fail(new Error('Session tree UI state patch must be an object.'))
  }

  return Effect.gen(function* () {
    const hasExpandedNodeIds = patch.expandedNodeIds !== undefined
    const hasBranchesSidebarCollapsed = patch.branchesSidebarCollapsed !== undefined
    if (!hasExpandedNodeIds && !hasBranchesSidebarCollapsed) {
      return yield* Effect.fail(
        new Error('Session tree UI state patch must include at least one field.'),
      )
    }

    const expandedNodeIds: SessionNodeId[] = []
    if (hasExpandedNodeIds) {
      if (!Array.isArray(patch.expandedNodeIds)) {
        return yield* Effect.fail(new Error('Expanded session node IDs must be an array.'))
      }
      for (const nodeId of patch.expandedNodeIds) {
        expandedNodeIds.push(yield* validateSessionNodeId(nodeId))
      }
    }

    if (
      patch.branchesSidebarCollapsed !== undefined &&
      typeof patch.branchesSidebarCollapsed !== 'boolean'
    ) {
      return yield* Effect.fail(new Error('Branches sidebar collapsed must be a boolean.'))
    }

    return {
      ...(hasExpandedNodeIds ? { expandedNodeIds } : {}),
      ...(hasBranchesSidebarCollapsed
        ? { branchesSidebarCollapsed: patch.branchesSidebarCollapsed }
        : {}),
    }
  })
}

function validateNavigateTreeOptions(
  options: SessionNavigateTreeOptions | undefined,
): Effect.Effect<SessionNavigateTreeOptions | undefined, Error> {
  if (options === undefined) {
    return Effect.succeed(undefined)
  }

  if (!isRecord(options)) {
    return Effect.fail(new Error('Session navigation options must be an object.'))
  }

  if (options.summarize !== undefined && typeof options.summarize !== 'boolean') {
    return Effect.fail(new Error('Session navigation summarize must be a boolean.'))
  }

  if (
    options.customInstructions !== undefined &&
    (typeof options.customInstructions !== 'string' ||
      options.customInstructions.trim().length === 0)
  ) {
    return Effect.fail(new Error('Session navigation custom instructions must be non-empty.'))
  }

  return Effect.succeed({
    ...(options.summarize !== undefined ? { summarize: options.summarize } : {}),
    ...(options.customInstructions ? { customInstructions: options.customInstructions } : {}),
  })
}

export function registerSessionsHandlers(): void {
  typedHandle('sessions:list', (_event, limit?: number) =>
    Effect.gen(function* () {
      const validatedLimit = yield* validateListLimit(limit)
      const repo = yield* SessionRepository
      const results = yield* repo.list(validatedLimit)
      return [...results]
    }),
  )

  typedHandle('sessions:list-archived-branches', (_event, limit?: number) =>
    Effect.gen(function* () {
      const validatedLimit = yield* validateListLimit(limit)
      const repo = yield* SessionRepository
      const results = yield* repo.listArchivedBranches(validatedLimit)
      return [...results]
    }),
  )

  typedHandle('sessions:get-tree', (_event, sessionId: SessionId) =>
    Effect.gen(function* () {
      const validatedSessionId = yield* validateSessionId(sessionId)
      const repo = yield* SessionRepository
      return yield* repo.getTree(validatedSessionId)
    }),
  )

  typedHandle(
    'sessions:get-workspace',
    (_event, sessionId: SessionId, selection?: SessionWorkspaceSelection) =>
      Effect.gen(function* () {
        const validatedSessionId = yield* validateSessionId(sessionId)
        const validatedSelection = yield* validateWorkspaceSelection(selection)
        const repo = yield* SessionRepository
        return yield* repo.getWorkspace(validatedSessionId, validatedSelection)
      }),
  )

  typedHandle(
    'sessions:navigate-tree',
    (
      _event,
      sessionId: SessionId,
      model: SupportedModelId,
      targetNodeId: SessionNodeId,
      options?: SessionNavigateTreeOptions,
    ) =>
      Effect.gen(function* () {
        const validatedSessionId = yield* validateSessionId(sessionId)
        const validatedTargetNodeId = yield* validateSessionNodeId(targetNodeId)
        const validatedOptions = yield* validateNavigateTreeOptions(options)
        return yield* navigateAgentSessionTree({
          conversationId: ConversationId(String(validatedSessionId)),
          model,
          targetNodeId: validatedTargetNodeId,
          ...(validatedOptions?.summarize !== undefined
            ? { summarize: validatedOptions.summarize }
            : {}),
          ...(validatedOptions?.customInstructions
            ? { customInstructions: validatedOptions.customInstructions }
            : {}),
        })
      }),
  )

  typedHandle(
    'sessions:rename-branch',
    (_event, sessionId: SessionId, branchId: SessionBranchId, name: string) =>
      Effect.gen(function* () {
        const validatedSessionId = yield* validateSessionId(sessionId)
        const validatedBranchId = yield* validateOptionalSessionBranchId(branchId)
        const validatedName = yield* validateBranchName(name)
        if (!validatedBranchId) {
          return yield* Effect.fail(new Error('Session branch ID must be a non-empty string.'))
        }
        const repo = yield* SessionRepository
        return yield* repo.renameBranch(validatedSessionId, validatedBranchId, validatedName)
      }),
  )

  typedHandle(
    'sessions:archive-branch',
    (_event, sessionId: SessionId, branchId: SessionBranchId) =>
      Effect.gen(function* () {
        const validatedSessionId = yield* validateSessionId(sessionId)
        const validatedBranchId = yield* validateOptionalSessionBranchId(branchId)
        if (!validatedBranchId) {
          return yield* Effect.fail(new Error('Session branch ID must be a non-empty string.'))
        }
        const repo = yield* SessionRepository
        return yield* repo.archiveBranch(validatedSessionId, validatedBranchId)
      }),
  )

  typedHandle(
    'sessions:restore-branch',
    (_event, sessionId: SessionId, branchId: SessionBranchId) =>
      Effect.gen(function* () {
        const validatedSessionId = yield* validateSessionId(sessionId)
        const validatedBranchId = yield* validateOptionalSessionBranchId(branchId)
        if (!validatedBranchId) {
          return yield* Effect.fail(new Error('Session branch ID must be a non-empty string.'))
        }
        const repo = yield* SessionRepository
        return yield* repo.restoreBranch(validatedSessionId, validatedBranchId)
      }),
  )

  typedHandle(
    'sessions:update-tree-ui-state',
    (_event, sessionId: SessionId, patch: SessionTreeUiStatePatch) =>
      Effect.gen(function* () {
        const validatedSessionId = yield* validateSessionId(sessionId)
        const validatedPatch = yield* validateTreeUiStatePatch(patch)
        const repo = yield* SessionRepository
        return yield* repo.updateTreeUiState(validatedSessionId, validatedPatch)
      }),
  )
}
