import { Schema } from '../schema'

export const migrationIdentitySchema = Schema.Struct({
  id: Schema.Int.pipe(Schema.positive()),
  name: Schema.NonEmptyString,
})
