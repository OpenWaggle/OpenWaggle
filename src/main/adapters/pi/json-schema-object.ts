import { isMatching, P } from '@diegogbrisa/ts-match'

export type JsonSchemaObject = { readonly [key: string]: unknown }
export type MutableJsonSchema = { [key: string]: unknown }

export function isJsonSchemaObject(value: unknown): value is JsonSchemaObject {
  return isMatching(P.record(P.string, P._), value) && !Array.isArray(value)
}

export function propertiesOf(schema: JsonSchemaObject): JsonSchemaObject {
  return isJsonSchemaObject(schema.properties) ? schema.properties : {}
}

export function requiredOf(schema: JsonSchemaObject): string[] {
  return Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === 'string')
    : []
}

export function schemaArray(value: unknown): JsonSchemaObject[] | undefined {
  return Array.isArray(value) ? value.filter(isJsonSchemaObject) : undefined
}
