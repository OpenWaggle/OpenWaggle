import type { Errors } from 'typebox/value'

type TypeBoxValidationError = ReturnType<typeof Errors>[number]

/** Formats TypeBox validation errors as one model-readable `path: message` list. */
export function formatTypeBoxErrors(errors: readonly TypeBoxValidationError[]) {
  return errors.map((error) => `${error.instancePath || 'arguments'}: ${error.message}`).join('; ')
}
