import * as ParseResult from 'effect/ParseResult'
import * as Schema from 'effect/Schema'

type AnySchema = Schema.Schema.AnyNoContext

export { ParseResult, Schema }

export type SchemaType<TSchema extends AnySchema> = Schema.Schema.Type<TSchema>

export interface SafeDecodeSuccess<A> {
  readonly success: true
  readonly data: A
}

export interface SafeDecodeFailure {
  readonly success: false
  readonly issues: readonly string[]
}

function formatIssuePath(path: ReadonlyArray<PropertyKey>): string {
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

export function decodeUnknownOrThrow<TSchema extends AnySchema>(
  schema: TSchema,
  value: unknown,
): SchemaType<TSchema> {
  return Schema.decodeUnknownSync(schema)(value)
}

export function safeDecodeUnknown<TSchema extends AnySchema>(
  schema: TSchema,
  value: unknown,
): SafeDecodeSuccess<SchemaType<TSchema>> | SafeDecodeFailure {
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
