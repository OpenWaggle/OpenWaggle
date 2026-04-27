import { ConversationId, SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { SessionNavigateTreeOptions, SessionWorkspaceSelection } from '@shared/types/session'
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
}
