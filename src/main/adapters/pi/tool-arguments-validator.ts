import { Compile } from 'typebox/schema'

type JsonSchemaObject = { readonly [key: string]: unknown }

const MAX_VALIDATION_DETAILS = 8

export type ToolArgumentsValidator = (arguments_: unknown) => readonly string[]

/**
 * Compiles `schema` so arguments can be checked against it exactly. Returns the compile error
 * instead of a validator when the schema uses something the validator cannot evaluate.
 */
export function compileToolArgumentsValidator(
  schema: JsonSchemaObject,
): { readonly validate: ToolArgumentsValidator } | { readonly error: string } {
  try {
    const validator = Compile(schema)
    return {
      validate: (arguments_) => {
        if (validator.Check(arguments_)) return []
        const [, errors] = validator.Errors(arguments_)
        return errors
          .slice(0, MAX_VALIDATION_DETAILS)
          .map((error) => `${error.instancePath || 'arguments'}: ${error.message}`)
      },
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}
