export function isNonEmptyTrimmed(value: string) {
  return value.trim().length > 0 || 'Must not be empty.'
}
