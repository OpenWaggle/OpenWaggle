import * as Effect from 'effect/Effect'
import {
  hostUiNonBlankStringSchema,
  hostUiStringSchema,
  optionalProjectPathArgumentSchema,
  providerCatalogScopeArgumentSchema,
} from './host-ui-argument-schemas'
import { decodeSessionOperationArgument } from './host-ui-session-operation-validation'

export function invalidHostUiInput(message: string) {
  return Effect.fail(new Error(message))
}

export function requireHostUiArgCount(
  args: readonly unknown[],
  minimum: number,
  maximum = minimum,
) {
  return args.length >= minimum && args.length <= maximum
    ? Effect.void
    : invalidHostUiInput(
        minimum === maximum
          ? `Expected ${String(minimum)} Host UI arguments.`
          : `Expected ${String(minimum)} to ${String(maximum)} Host UI arguments.`,
      )
}

export function requiredHostUiString(value: unknown, label: string) {
  return decodeSessionOperationArgument(hostUiNonBlankStringSchema(label), value)
}

export function hostUiStringValue(value: unknown, label: string) {
  return decodeSessionOperationArgument(hostUiStringSchema(label), value)
}

export function optionalHostUiProjectPath(value: unknown) {
  return decodeSessionOperationArgument(optionalProjectPathArgumentSchema, value)
}

export function optionalHostUiProviderCatalogScope(value: unknown) {
  return value === undefined
    ? Effect.succeed(undefined)
    : decodeSessionOperationArgument(providerCatalogScopeArgumentSchema, value)
}

export function oneInput<A, E, R>(
  args: readonly unknown[],
  operation: (input: unknown) => Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    yield* requireHostUiArgCount(args, 1)
    return yield* operation(args[0])
  })
}

export function twoInputs<A, E, R>(
  args: readonly unknown[],
  operation: (first: unknown, second: unknown) => Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    yield* requireHostUiArgCount(args, TWO_ARGUMENTS)
    return yield* operation(args[0], args[1])
  })
}

export function oneOrTwoInputs<A, E, R>(
  args: readonly unknown[],
  operation: (first: unknown, second?: unknown) => Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    yield* requireHostUiArgCount(args, 1, TWO_ARGUMENTS)
    return yield* operation(args[0], args[1])
  })
}

export const TWO_ARGUMENTS = 2
