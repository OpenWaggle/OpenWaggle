import { type Schema, safeDecodeUnknown } from '@shared/schema'
import {
  sessionDetailCursorSchema,
  sessionTreeSearchCursorSchema,
  sessionTreeSearchQuerySchema,
  sessionWorkspaceRequestSchema,
} from '@shared/schemas/session-data-requests'
import {
  sessionDetailView,
  sessionTreeView,
  sessionWorkspaceView,
} from '@shared/utils/session-data-view'
import * as Effect from 'effect/Effect'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { SessionRepository } from '../ports/session-repository'
import {
  invalid,
  requireArgCount,
  requiredString,
  requireOptionalArgCount,
  validateSessionId,
  validateWorkspaceSelection,
} from './host-ui-session-operation-validation'
import { withDeletedPiSessionFileNotice } from './pi-session-deleted-files'
import { openedSessionId } from './pi-session-projection-refresh'
import { withPiSessionPromptOrigin } from './pi-session-prompt-origin'

/**
 * The desktop window's reads of a Session's detail, tree and workspace (v1 performance, B5/D5):
 * what crosses to the window is bounded by the views in `session-data-view`, and the node mutation
 * revision is always read before the nodes it labels, so reused content is never newer than it.
 */

const TWO_ARGUMENTS = 2
const THREE_ARGUMENTS = 3
/** `sessions:search-tree`'s optional third argument: the previous search's cursor. */
const TREE_SEARCH_CURSOR_ARGUMENT = 2
/** Matches the store's batch bound (`MAX_TURN_DIFF_FILE_BATCH`). */
const MAX_TURN_DIFF_FILE_BATCH = 500

/** Decodes an optional trailing request argument with its schema, or fails naming `label`. */
function decodeOptionalArgument<A, I>(
  schema: Schema.Schema<A, I, never>,
  value: unknown,
  label: string,
) {
  if (value === undefined) return Effect.succeed(undefined)
  const decoded = safeDecodeUnknown(schema, value)
  return decoded.success
    ? Effect.succeed(decoded.data)
    : invalid(`${label} is invalid: ${decoded.issues.join('; ')}`)
}

export function getSessionDetail(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireOptionalArgCount(args, 1, TWO_ARGUMENTS)
    const sessionId = yield* openedSessionId(args[0])
    const cursor = yield* decodeOptionalArgument(
      sessionDetailCursorSchema,
      args[1],
      'Session detail cursor',
    )
    // Read before the nodes, so the detail is never labelled with a revision older than it.
    const revision =
      cursor === undefined
        ? null
        : yield* (yield* SessionRepository).getNodeMutationRevision(sessionId)
    const detail = (yield* SessionProjectionRepository).getOptional(sessionId)
    const shown = yield* withPiSessionPromptOrigin(
      yield* withDeletedPiSessionFileNotice(yield* detail),
    )
    return cursor === undefined ? shown : sessionDetailView(shown, cursor, revision)
  })
}

export function getSessionTree(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireArgCount(args, 1)
    const tree = yield* (yield* SessionRepository).getTree(yield* openedSessionId(args[0]))
    return tree ? sessionTreeView(tree) : null
  })
}

export function getSessionWorkspace(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireOptionalArgCount(args, 1, THREE_ARGUMENTS)
    const sessionId = yield* openedSessionId(args[0])
    const selection = yield* validateWorkspaceSelection(args[1])
    const request = yield* decodeOptionalArgument(
      sessionWorkspaceRequestSchema,
      args[TWO_ARGUMENTS],
      'Session workspace request',
    )
    const repository = yield* SessionRepository
    // Read before the nodes, so reused content is never newer than the revision it carries.
    const revision =
      request === undefined ? null : yield* repository.getNodeMutationRevision(sessionId)
    const workspace = yield* repository.getWorkspace(sessionId, selection)
    return workspace ? sessionWorkspaceView(workspace, request, revision) : null
  })
}

export function searchSessionTree(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireOptionalArgCount(args, TWO_ARGUMENTS, THREE_ARGUMENTS)
    const sessionId = yield* openedSessionId(args[0])
    const query = yield* decodeOptionalArgument(
      sessionTreeSearchQuerySchema,
      args[1],
      'Session tree search query',
    )
    const after = yield* decodeOptionalArgument(
      sessionTreeSearchCursorSchema,
      args[TREE_SEARCH_CURSOR_ARGUMENT],
      'Session tree search cursor',
    )
    return yield* (yield* SessionRepository).searchTreeNodes(sessionId, query ?? '', after)
  })
}

export function listTurnDiffFiles(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireArgCount(args, TWO_ARGUMENTS)
    const sessionId = yield* validateSessionId(args[0])
    const turnIds = args[1]
    if (!Array.isArray(turnIds) || turnIds.length > MAX_TURN_DIFF_FILE_BATCH) {
      return yield* invalid('Turn IDs must be an array of at most 500 turn IDs.')
    }
    const validated: string[] = []
    for (const turnId of turnIds) validated.push(yield* requiredString(turnId, 'Turn ID'))
    return yield* (yield* SessionProjectionRepository).listTurnDiffFiles(sessionId, validated)
  })
}
