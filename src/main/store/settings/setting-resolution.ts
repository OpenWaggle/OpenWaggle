export function resolveUpdatedSetting<Input, Output>(
  candidate: Input | undefined,
  current: Output,
  resolve: (value: Input) => Output,
) {
  if (candidate === undefined) return current
  return resolve(candidate)
}

export function resolveValidatedSetting<Value>(
  candidate: Value | undefined,
  current: Value,
  isValid: (value: Value) => boolean,
) {
  if (candidate === undefined) return current
  return isValid(candidate) ? candidate : current
}
