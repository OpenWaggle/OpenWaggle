import type { SchemaType } from '@shared/schema'
import type { NestedToolCallRecord, NestedToolCalls } from '@shared/types/tools'
import { describe, expectTypeOf, it } from 'vitest'
import type { nestedToolCallsSchema } from '../nested-tool-calls'

type DecodedNestedToolCalls = SchemaType<typeof nestedToolCallsSchema>

describe('nestedToolCallsSchema', () => {
  // A field added to the record and not to the schema makes an exact decode reject live Runs.
  it('describes every field of the nested-call record', () => {
    expectTypeOf<keyof DecodedNestedToolCalls>().toEqualTypeOf<keyof NestedToolCalls>()
    expectTypeOf<keyof DecodedNestedToolCalls['calls'][number]>().toEqualTypeOf<
      keyof NestedToolCallRecord
    >()
    expectTypeOf<DecodedNestedToolCalls>().toExtend<NestedToolCalls>()
  })
})
