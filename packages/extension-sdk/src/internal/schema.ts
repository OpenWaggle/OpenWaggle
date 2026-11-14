import * as ParseResult from 'effect/ParseResult'
import type * as Schema from 'effect/Schema'
import * as SchemaAST from 'effect/SchemaAST'
import type { ExtensionValidationIssue, ExtensionValidationResult } from '../validation-types.js'

type AnySchema = Schema.Schema.AnyNoContext

export type SchemaType<TSchema extends AnySchema> = Schema.Schema.Type<TSchema>

const ROOT_ISSUE_PATH = '(root)'

/** The host's diagnostic path: field names and array indexes joined by dots. */
function formatIssuePath(path: readonly PropertyKey[]) {
  const joinedPath = path.map(String).join('.')
  return joinedPath.length > 0 ? joinedPath : ROOT_ISSUE_PATH
}

/**
 * Effect's message for a value of the wrong type spells out the whole expected schema, so a
 * manifest that is not an object gets a message several kilobytes long. For an object or an array,
 * say which it should be instead; every other message stays Effect's.
 */
function structuralExpectation(ast: SchemaAST.AST) {
  if (SchemaAST.isTypeLiteral(ast)) return 'an object'
  if (SchemaAST.isTupleType(ast)) return 'an array'
  return undefined
}

interface ShortTypeMessage {
  readonly path: string
  /** The start of Effect's message, `Expected <schema>, actual `, which the short one replaces. */
  readonly prefix: string
  readonly replacement: string
}

/** The wrong-type issues whose message would print a whole object or array schema. */
function shortTypeMessages(issue: ParseResult.ParseIssue) {
  const found: ShortTypeMessage[] = []
  const visit = (current: ParseResult.ParseIssue, path: readonly PropertyKey[]) => {
    if (current._tag === 'Type') {
      const expected = structuralExpectation(current.ast)
      if (expected === undefined || current.message !== undefined) return
      found.push({
        path: formatIssuePath(path),
        prefix: `Expected ${String(current.ast)}, actual `,
        replacement: `Expected ${expected}, actual `,
      })
      return
    }
    if (current._tag === 'Pointer') {
      const keys: readonly PropertyKey[] =
        typeof current.path === 'object' ? current.path : [current.path]
      visit(current.issue, [...path, ...keys])
      return
    }
    if (current._tag === 'Composite') {
      const inner: readonly ParseResult.ParseIssue[] =
        '_tag' in current.issues ? [current.issues] : current.issues
      for (const child of inner) visit(child, path)
      return
    }
    // Missing, Unexpected and Forbidden issues have no inner issue and print no schema.
    if (current._tag === 'Refinement' || current._tag === 'Transformation') {
      visit(current.issue, path)
    }
  }
  visit(issue, [])
  return found
}

function shortenedMessage(path: string, message: string, short: readonly ShortTypeMessage[]) {
  const match = short.find(
    (candidate) => candidate.path === path && message.startsWith(candidate.prefix),
  )
  return match === undefined ? message : `${match.replacement}${message.slice(match.prefix.length)}`
}

/** The path of an issue that no field path locates: reading the value itself threw. */
const UNREADABLE_ISSUE_PATH = ''

function thrownMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : 'an unknown error'
}

function decodeWithSchema<TValue, TEncoded>(
  schema: Schema.Schema<TValue, TEncoded>,
  value: unknown,
  options: { readonly onExcessProperty?: 'ignore' | 'error' },
) {
  const decoded = ParseResult.decodeUnknownEither(schema, { errors: 'all', ...options })(value)
  if (decoded._tag === 'Right') {
    return { success: true, value: decoded.right } satisfies ExtensionValidationResult<TValue>
  }
  const short = shortTypeMessages(decoded.left)
  return {
    success: false,
    issues: ParseResult.ArrayFormatter.formatIssueSync(decoded.left).map((issue) => {
      const path = formatIssuePath(issue.path)
      return { path, message: shortenedMessage(path, issue.message, short) }
    }),
  } satisfies ExtensionValidationResult<TValue>
}

/**
 * Decodes `value`, returning the decoded value or every issue. It never throws: a value whose
 * reading throws, such as a throwing getter or a Proxy, is one issue with an empty path.
 */
export function validateWithSchema<TValue, TEncoded>(
  schema: Schema.Schema<TValue, TEncoded>,
  value: unknown,
  options: { readonly onExcessProperty?: 'ignore' | 'error' } = {},
) {
  try {
    return decodeWithSchema(schema, value, options)
  } catch (error) {
    return {
      success: false,
      issues: [
        {
          path: UNREADABLE_ISSUE_PATH,
          message: `Could not read the value: ${thrownMessage(error)}`,
        },
      ],
    } satisfies ExtensionValidationResult<TValue>
  }
}

/** An issue as one line, `path: message`, the way the broker reports invalid payloads. */
export function formatValidationIssue(issue: ExtensionValidationIssue) {
  return `${issue.path}: ${issue.message}`
}
