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

function formatIssuePath(path: readonly PropertyKey[]) {
  const joinedPath = path.map(String).join('.')
  return joinedPath.length > 0 ? joinedPath : '(root)'
}

function formatParseError(error: ParseResult.ParseError) {
  return ParseResult.ArrayFormatter.formatErrorSync(error).map(
    (issue) => `${formatIssuePath(issue.path)}: ${issue.message}`,
  )
}

export function safeDecodeExtensionSchema<TValue, TEncoded>(
  schema: Schema.Schema<TValue, TEncoded>,
  value: unknown,
) {
  try {
    const result: ExtensionSchemaDecodeSuccess<TValue> | ExtensionSchemaDecodeFailure = {
      success: true,
      data: ParseResult.decodeUnknownSync(schema)(value),
    }
    return result
  } catch (error) {
    if (ParseResult.isParseError(error)) {
      const result: ExtensionSchemaDecodeSuccess<TValue> | ExtensionSchemaDecodeFailure = {
        success: false,
        issues: formatParseError(error),
      }
      return result
    }
    throw error
  }
}
