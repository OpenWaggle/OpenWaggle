import * as ParseResult from 'effect/ParseResult'
import type * as Schema from 'effect/Schema'

type AnySchema = Schema.Schema.AnyNoContext

export type SchemaType<TSchema extends AnySchema> = Schema.Schema.Type<TSchema>

export interface ExtensionSchemaDecodeSuccess<TValue> {
  readonly success: true
  readonly data: TValue
}

export interface ExtensionSchemaDecodeFailure {
  readonly success: false
  readonly issues: readonly string[]
}

function formatIssuePath(path: ReadonlyArray<PropertyKey>) {
  const joinedPath = path.map(String).join('.')
  return joinedPath.length > 0 ? joinedPath : '(root)'
}

function formatParseError(error: ParseResult.ParseError) {
  return ParseResult.ArrayFormatter.formatErrorSync(error).map(
    (issue) => `${formatIssuePath(issue.path)}: ${issue.message}`,
  )
}

export function safeDecodeExtensionSchema<TValue, TEncoded>(
  schema: Schema.Schema<TValue, TEncoded, never>,
  value: unknown,
): ExtensionSchemaDecodeSuccess<TValue> | ExtensionSchemaDecodeFailure {
  try {
    return {
      success: true,
      data: ParseResult.decodeUnknownSync(schema)(value),
    }
  } catch (error) {
    if (ParseResult.isParseError(error)) {
      return {
        success: false,
        issues: formatParseError(error),
      }
    }
    throw error
  }
}
