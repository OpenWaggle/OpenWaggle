export function resolveUpdatedSetting<Input, Output>(
  candidate: Input | undefined,
  current: Output,
  resolve: (value: Input) => Output,
): Output {
  if (candidate === undefined) return current
  return resolve(candidate)
}

export function resolveValidatedSetting<Value>(
  candidate: Value | undefined,
  current: Value,
  isValid: (value: Value) => boolean,
): Value {
  if (candidate === undefined) return current
  return isValid(candidate) ? candidate : current
}
