import * as Option from 'effect/Option'
import * as ParseResult from 'effect/ParseResult'
import * as Schema from 'effect/Schema'

type AnySchema = Schema.Schema.AnyNoContext

export { ParseResult, Schema }

export type SchemaType<TSchema extends AnySchema> = Schema.Schema.Type<TSchema>

/**
 * An optional property that is absent from the decoded value both when the input omits it and
 * when it carries `undefined`, as a structured-clone IPC argument can. The decoded type has an
 * exact optional field (`?: A`), so consumers never see a present `undefined`.
 */
export function optionalExact<A, I, R>(schema: Schema.Schema<A, I, R>) {
  return Schema.optionalToOptional(Schema.UndefinedOr(schema), Schema.typeSchema(schema), {
    decode: Option.filter((value: A | undefined): value is A => value !== undefined),
    encode: (value) => value,
  })
}

export interface SafeDecodeSuccess<A> {
  readonly success: true
  readonly data: A
}

export interface SafeDecodeFailure {
  readonly success: false
  readonly issues: readonly string[]
}

function formatIssuePath(path: readonly PropertyKey[]) {
  const joinedPath = path.map(String).join('.')
  return joinedPath.length > 0 ? joinedPath : '(root)'
}

export function formatParseError(error: ParseResult.ParseError): readonly string[] {
  return ParseResult.ArrayFormatter.formatErrorSync(error).map(
    (issue) => `${formatIssuePath(issue.path)}: ${issue.message}`,
  )
}

export function getParseIssues(error: unknown): readonly string[] | null {
  return ParseResult.isParseError(error) ? formatParseError(error) : null
}

/**
 * Where a decode failed and how (`path: Missing`, `path: Unexpected`, ...), without the issue
 * messages: those embed the value that failed, which can be transcript or tool content.
 */
export function getParseIssuePaths(error: unknown): readonly string[] | null {
  if (!ParseResult.isParseError(error)) return null
  return ParseResult.ArrayFormatter.formatErrorSync(error).map(
    (issue) => `${formatIssuePath(issue.path)}: ${issue._tag}`,
  )
}

export function decodeUnknownOrThrow<A, I>(schema: Schema.Schema<A, I>, value: unknown): A {
  return ParseResult.decodeUnknownSync(schema)(value)
}

/** Decode an external boundary while rejecting undeclared object properties. */
export function decodeUnknownExactOrThrow<A, I>(schema: Schema.Schema<A, I>, value: unknown): A {
  return ParseResult.decodeUnknownSync(schema, { onExcessProperty: 'error' })(value)
}

export function parseJsonUnknown(raw: string): unknown {
  const parsed: unknown = JSON.parse(raw)
  return parsed
}

export function safeDecodeUnknown<A, I>(
  schema: Schema.Schema<A, I>,
  value: unknown,
): SafeDecodeSuccess<A> | SafeDecodeFailure {
  try {
    return {
      success: true,
      data: decodeUnknownOrThrow(schema, value),
    }
  } catch (error) {
    const issues = getParseIssues(error)
    if (issues) {
      return {
        success: false,
        issues,
      }
    }
    throw error
  }
}
