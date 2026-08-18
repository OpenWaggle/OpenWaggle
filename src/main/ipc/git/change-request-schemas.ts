import { Schema } from '@shared/schema'

/** A change request reference: number, URL, or branch name. */
export const referenceSchema = Schema.String.pipe(Schema.minLength(1))
