import * as Effect from 'effect/Effect'

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
  return typeof value === 'string' && value.trim().length > 0
    ? Effect.succeed(value)
    : invalidHostUiInput(`${label} must be a non-empty string.`)
}

export function hostUiStringValue(value: unknown, label: string) {
  return typeof value === 'string'
    ? Effect.succeed(value)
    : invalidHostUiInput(`${label} must be a string.`)
}

export function optionalHostUiProjectPath(value: unknown) {
  return value === undefined || value === null || typeof value === 'string'
    ? Effect.succeed(value)
    : invalidHostUiInput('Project path must be a string, null, or omitted.')
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
