import { Schema } from '@shared/schema'

/** A change request reference: number, URL, or branch name. */
export const referenceSchema = Schema.String.pipe(Schema.minLength(1))

/** How a selected change request is adopted: switch the checkout, or only fetch the ref. */
export const adoptionSchema = Schema.Literal('checkout', 'fetch')
