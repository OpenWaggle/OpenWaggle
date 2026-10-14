import type { SchemaType } from '@shared/schema'
import type { NestedToolCallRecord, NestedToolCalls } from '@shared/types/tools'
import { describe, expectTypeOf, it } from 'vitest'
import type { nestedToolCallsSchema } from '../nested-tool-calls'

type DecodedNestedToolCalls = SchemaType<typeof nestedToolCallsSchema>
type DecodedNestedToolCallRecord = DecodedNestedToolCalls['calls'][number]

describe('nestedToolCallsSchema', () => {
  /*
   * An exact decode rejects any record the schema is narrower than. The keys catch a field the
   * type gains; the two-way assignability catches a narrowed literal, value type or optionality.
   * `toEqualTypeOf` is not usable: the schema's arrays and JSON objects are mutable.
   */
  it('describes every field of the nested-call record', () => {
    expectTypeOf<keyof DecodedNestedToolCalls>().toEqualTypeOf<keyof NestedToolCalls>()
    expectTypeOf<keyof DecodedNestedToolCallRecord>().toEqualTypeOf<keyof NestedToolCallRecord>()
    expectTypeOf<DecodedNestedToolCalls>().toExtend<NestedToolCalls>()
    expectTypeOf<NestedToolCalls>().toExtend<DecodedNestedToolCalls>()
    expectTypeOf<NestedToolCallRecord>().toExtend<DecodedNestedToolCallRecord>()
  })
})
