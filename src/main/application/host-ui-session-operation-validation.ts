import { type Schema, safeDecodeUnknown } from '@shared/schema'
import {
  pinnedSessionMoveSchema,
  sessionNavigateTreeOptionsSchema,
  sessionOperationBranchIdSchema,
  sessionOperationNodeIdSchema,
  sessionOperationSessionIdSchema,
  sessionTreeUiStatePatchSchema,
  sessionWorkspaceSelectionSchema,
  sessionWorktreePlanSchema,
} from '@shared/schemas/session-operation-requests'
import * as Effect from 'effect/Effect'
import {
  sessionModelArgumentSchema,
  sessionOperationStringSchema,
  thinkingLevelArgumentSchema,
} from './host-ui-argument-schemas'

const ROOT_ISSUE_PREFIX = '(root): '
/** The other member a nullable or optional field also failed, e.g. `nodeId: Expected null, ...`. */
const ALTERNATIVE_MEMBER_MESSAGE = /^Expected (null|undefined), actual /

function issueParts(issue: string) {
  const separator = issue.indexOf(': ')
  return { path: issue.slice(0, separator), message: issue.slice(separator + ': '.length) }
}

/**
 * The issues of a refused argument as `path: message`, the path naming the field. An issue at
 * the argument itself is its message alone, and a field's failed `null` or `undefined` member is
 * dropped while the field, or a value inside it, has a real issue.
 */
function readableIssues(issues: readonly string[]) {
  const parts = issues.map(issueParts)
  return issues
    .filter((_, index) => {
      const { path, message } = parts[index] ?? { path: '', message: '' }
      return (
        !ALTERNATIVE_MEMBER_MESSAGE.test(message) ||
        !parts.some(
          (other) =>
            (other.path === path || other.path.startsWith(`${path}.`)) &&
            !ALTERNATIVE_MEMBER_MESSAGE.test(other.message),
        )
      )
    })
    .map((issue) =>
      issue.startsWith(ROOT_ISSUE_PREFIX) ? issue.slice(ROOT_ISSUE_PREFIX.length) : issue,
    )
}

/** Decodes one Session operation argument with its schema, or fails naming the refused field. */
export function decodeSessionOperationArgument<A, I>(
  schema: Schema.Schema<A, I>,
  value: unknown,
): Effect.Effect<A, Error> {
  const decoded = safeDecodeUnknown(schema, value)
  return decoded.success
    ? Effect.succeed(decoded.data)
    : invalid(readableIssues(decoded.issues).join('; '))
}

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
  return decodeSessionOperationArgument(sessionOperationStringSchema(label), value)
}

export function validateSessionId(value: unknown) {
  return decodeSessionOperationArgument(sessionOperationSessionIdSchema, value)
}

export function validateSessionNodeId(value: unknown) {
  return decodeSessionOperationArgument(sessionOperationNodeIdSchema, value)
}

export function validateSessionBranchId(value: unknown) {
  return decodeSessionOperationArgument(sessionOperationBranchIdSchema, value)
}

export function validateOptionalModel(value: unknown) {
  return value === undefined
    ? Effect.succeed(undefined)
    : decodeSessionOperationArgument(sessionModelArgumentSchema, value)
}

export function validateThinkingLevel(value: unknown) {
  return decodeSessionOperationArgument(thinkingLevelArgumentSchema, value)
}

export function validateOptionalThinkingLevel(value: unknown) {
  return value === undefined ? Effect.succeed(undefined) : validateThinkingLevel(value)
}

export function validateWorkspaceSelection(value: unknown) {
  return value === undefined
    ? Effect.succeed(undefined)
    : decodeSessionOperationArgument(sessionWorkspaceSelectionSchema, value)
}

export function validateTreeUiStatePatch(value: unknown) {
  return decodeSessionOperationArgument(sessionTreeUiStatePatchSchema, value)
}

export function validateNavigateTreeOptions(value: unknown) {
  return value === undefined
    ? Effect.succeed(undefined)
    : decodeSessionOperationArgument(sessionNavigateTreeOptionsSchema, value)
}

export function validateWorktreePlan(value: unknown) {
  return value === undefined
    ? Effect.succeed(undefined)
    : decodeSessionOperationArgument(sessionWorktreePlanSchema, value)
}

export function validatePinnedSessionMove(value: unknown) {
  return decodeSessionOperationArgument(pinnedSessionMoveSchema, value)
}
