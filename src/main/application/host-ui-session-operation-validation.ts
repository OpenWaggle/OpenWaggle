import { isSessionInputTextWithinLimit, SESSION_INPUT_LIMITS } from '@shared/session-input-limits'
import { SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import type {
  PinnedSessionMove,
  SessionNavigateTreeOptions,
  SessionTreeUiStatePatch,
  SessionWorkspaceSelection,
  SessionWorktreePlan,
} from '@shared/types/session'
import { isRecord } from '@shared/utils/validation'
import * as Effect from 'effect/Effect'

export function invalid(message: string) {
  return Effect.fail(new Error(message))
}

export function requireArgCount(args: readonly unknown[], count: number) {
  return args.length === count
    ? Effect.void
    : invalid(`Expected ${String(count)} Session operation arguments.`)
}

export function requireOptionalArgCount(
  args: readonly unknown[],
  minimum: number,
  maximum: number,
) {
  return args.length >= minimum && args.length <= maximum
    ? Effect.void
    : invalid(`Expected ${String(minimum)} to ${String(maximum)} Session operation arguments.`)
}

export function requiredString(value: unknown, label: string): Effect.Effect<string, Error> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return invalid(`${label} must be a non-empty string.`)
  }
  if (value.length > SESSION_INPUT_LIMITS.pathLength) {
    return invalid(`${label} exceeds the input limit.`)
  }
  return Effect.succeed(value)
}

function requiredId(value: unknown, label: string): Effect.Effect<string, Error> {
  return requiredString(value, label).pipe(
    Effect.flatMap((id) =>
      id.length <= SESSION_INPUT_LIMITS.idLength
        ? Effect.succeed(id)
        : invalid(`${label} exceeds the input limit.`),
    ),
  )
}

export function validateSessionId(value: unknown) {
  return requiredId(value, 'Session ID').pipe(Effect.map(SessionId))
}

export function validateSessionNodeId(value: unknown) {
  return requiredId(value, 'Session node ID').pipe(Effect.map(SessionNodeId))
}

export function validateSessionBranchId(value: unknown) {
  return requiredId(value, 'Session branch ID').pipe(Effect.map(SessionBranchId))
}

function validateOptionalSessionNodeId(value: unknown) {
  return value === null || value === undefined
    ? Effect.succeed(value)
    : validateSessionNodeId(value)
}

function validateOptionalSessionBranchId(value: unknown) {
  return value === null || value === undefined
    ? Effect.succeed(value)
    : validateSessionBranchId(value)
}

function validateOptionalLastVisitedAt(value: unknown) {
  if (value === undefined) return Effect.succeed(undefined)
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? Effect.succeed(value)
    : invalid('Session last-visited timestamp must be a non-negative integer.')
}

export function validateWorkspaceSelection(value: unknown) {
  if (value === undefined) return Effect.succeed(undefined)
  if (!isRecord(value)) return invalid('Session workspace selection must be an object.')
  return Effect.gen(function* () {
    const branchId = yield* validateOptionalSessionBranchId(value.branchId)
    const nodeId = yield* validateOptionalSessionNodeId(value.nodeId)
    return { branchId, nodeId } satisfies SessionWorkspaceSelection
  })
}

export function validateTreeUiStatePatch(value: unknown) {
  if (!isRecord(value)) return invalid('Session tree UI state patch must be an object.')
  return Effect.gen(function* () {
    const hasExpandedNodeIds = value.expandedNodeIds !== undefined
    const hasBranchesSidebarCollapsed = value.branchesSidebarCollapsed !== undefined
    const hasLastVisitedAt = value.lastVisitedAt !== undefined
    if (!hasExpandedNodeIds && !hasBranchesSidebarCollapsed && !hasLastVisitedAt) {
      return yield* invalid('Session tree UI state patch must include at least one field.')
    }
    const expandedNodeIds: SessionNodeId[] = []
    if (hasExpandedNodeIds) {
      if (!Array.isArray(value.expandedNodeIds)) {
        return yield* invalid('Expanded session node IDs must be an array.')
      }
      if (value.expandedNodeIds.length > SESSION_INPUT_LIMITS.expandedTreeNodeItems) {
        return yield* invalid('Expanded session node IDs exceed the input limit.')
      }
      for (const nodeId of value.expandedNodeIds) {
        expandedNodeIds.push(yield* validateSessionNodeId(nodeId))
      }
    }
    if (
      value.branchesSidebarCollapsed !== undefined &&
      typeof value.branchesSidebarCollapsed !== 'boolean'
    ) {
      return yield* invalid('Branches sidebar collapsed must be a boolean.')
    }
    const lastVisitedAt = yield* validateOptionalLastVisitedAt(value.lastVisitedAt)
    return {
      ...(hasExpandedNodeIds ? { expandedNodeIds } : {}),
      ...(hasBranchesSidebarCollapsed
        ? { branchesSidebarCollapsed: value.branchesSidebarCollapsed }
        : {}),
      ...(hasLastVisitedAt ? { lastVisitedAt } : {}),
    } satisfies SessionTreeUiStatePatch
  })
}

export function validateNavigateTreeOptions(value: unknown) {
  if (value === undefined) return Effect.succeed(undefined)
  if (!isRecord(value)) return invalid('Session navigation options must be an object.')
  if (value.summarize !== undefined && typeof value.summarize !== 'boolean') {
    return invalid('Session navigation summarize must be a boolean.')
  }
  if (
    value.customInstructions !== undefined &&
    (typeof value.customInstructions !== 'string' ||
      value.customInstructions.trim().length === 0 ||
      !isSessionInputTextWithinLimit(value.customInstructions))
  ) {
    return invalid('Session navigation custom instructions must be non-empty.')
  }
  return Effect.succeed({
    ...(value.summarize !== undefined ? { summarize: value.summarize } : {}),
    ...(value.customInstructions ? { customInstructions: value.customInstructions } : {}),
  } satisfies SessionNavigateTreeOptions)
}

export function validateWorktreePlan(value: unknown) {
  if (value === undefined) return Effect.succeed(undefined)
  if (!isRecord(value)) return invalid('Session worktree plan must be an object.')
  if (value.environmentMode !== 'local' && value.environmentMode !== 'worktree') {
    return invalid('Session environment mode must be local or worktree.')
  }
  if (value.baseRef !== null && typeof value.baseRef !== 'string') {
    return invalid('Session Worktree base ref must be a string or null.')
  }
  if (typeof value.startFromOrigin !== 'boolean') {
    return invalid('Session Worktree origin selection must be a boolean.')
  }
  return Effect.succeed({
    environmentMode: value.environmentMode,
    baseRef: value.baseRef,
    startFromOrigin: value.startFromOrigin,
  } satisfies SessionWorktreePlan)
}

export function validatePinnedSessionMove(value: unknown) {
  if (!isRecord(value)) return invalid('Pinned Session move must be an object.')
  return Effect.gen(function* () {
    const sessionId = yield* validateSessionId(value.sessionId)
    const afterSessionId = yield* validateOptionalPinnedSessionId(value.afterSessionId)
    const beforeSessionId = yield* validateOptionalPinnedSessionId(value.beforeSessionId)
    return { sessionId, afterSessionId, beforeSessionId } satisfies PinnedSessionMove
  })
}

function validateOptionalPinnedSessionId(value: unknown) {
  return value === null ? Effect.succeed(null) : validateSessionId(value)
}
