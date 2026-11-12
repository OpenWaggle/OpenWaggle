import { Option } from 'effect'
import { Schema } from '@shared/schema'

/**
 * Tolerant-reader fields whose decoded type matches a strict schema's exactly, under
 * `exactOptionalPropertyTypes`: a field that is missing or does not decode is left out (or takes
 * its fallback) instead of becoming `undefined`. Like `./lenient`, use these only where the old
 * reader skipped a malformed field on purpose.
 */

/** An exact optional property: its value when it decodes, otherwise no property at all. */
export function lenientExactOptional<A, I>(schema: Schema.Schema<A, I>) {
  const decode = Schema.decodeUnknownOption(schema)
  return Schema.optionalToOptional(Schema.Unknown, Schema.typeSchema(schema), {
    decode: (value) => Option.flatMap(value, decode),
    encode: (value) => value,
  })
}

/** A required property: its value when it decodes, otherwise `fallback`. */
export function lenientWithFallback<A, I>(schema: Schema.Schema<A, I>, fallback: () => NoInfer<A>) {
  const decode = Schema.decodeUnknownOption(schema)
  return Schema.optionalToRequired(Schema.Unknown, Schema.typeSchema(schema), {
    decode: (value) => Option.getOrElse(Option.flatMap(value, decode), fallback),
    encode: (value) => Option.some(value),
  })
}
