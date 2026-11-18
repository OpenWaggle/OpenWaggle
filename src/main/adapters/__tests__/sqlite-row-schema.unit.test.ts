import { Schema } from '@shared/schema'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { decodeSqlRows, sqliteIntegerSchema } from '../sqlite-row-schema'

const rowSchema = Schema.Struct({ id: Schema.String, revision: sqliteIntegerSchema })

describe('decodeSqlRows', () => {
  it('returns the rows its schema decodes', async () => {
    const rows = await Effect.runPromise(
      decodeSqlRows(rowSchema, 'items')([{ id: 'a', revision: 1 }]),
    )
    expect(rows).toEqual([{ id: 'a', revision: 1 }])
  })

  it('fails the query naming the table and column, without the column value', async () => {
    const error = await Effect.runPromise(
      Effect.flip(decodeSqlRows(rowSchema, 'items')([{ id: 'secret text', revision: 'two' }])),
    )
    expect(error._tag).toBe('SqlError')
    expect(error.message).toBe('Invalid items row: 0.revision: Type')
    expect(error.message).not.toContain('two')
  })
})
