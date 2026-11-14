import { SqlError } from '@effect/sql/SqlError'
import { ParseResult, Schema } from '@shared/schema'
import * as Effect from 'effect/Effect'

/**
 * Decodes the rows a query returned with the one schema that describes them, so a row type is
 * inferred from its schema rather than trusted from a `sql<Row>` annotation. A row that does not
 * match fails the query as a `SqlError` naming the table and the columns that were wrong. The
 * message names each column and how it failed but not its value, which can be transcript text.
 */
export function decodeSqlRows<A, I>(schema: Schema.Schema<A, I>, table: string) {
  const decode = ParseResult.decodeUnknownEither(Schema.Array(schema))
  return (rows: unknown) => {
    const decoded = decode(rows)
    if (decoded._tag === 'Right') return Effect.succeed(decoded.right)
    const issues = ParseResult.ArrayFormatter.formatIssueSync(decoded.left)
      .map((issue) => `${issue.path.map(String).join('.')}: ${issue._tag}`)
      .join('; ')
    return Effect.fail(
      new SqlError({ cause: decoded.left, message: `Invalid ${table} row: ${issues}` }),
    )
  }
}

/** A SQLite integer column read as a JavaScript number. */
export const sqliteIntegerSchema = Schema.Number.pipe(Schema.int())
