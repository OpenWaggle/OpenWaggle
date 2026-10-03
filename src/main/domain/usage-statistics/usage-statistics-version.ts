/**
 * Semantic version precedence (semver 2.0.0, section 11) for the release versions Usage statistics
 * publish. `update.installed` counts only a launch whose version is higher than the previous one,
 * so a downgrade, or a channel switch that installs an older build, is not an update.
 */
const RELEASE_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9a-z.-]+))?$/iu
const NUMERIC_IDENTIFIER_PATTERN = /^\d+$/u

interface ParsedVersion {
  readonly core: readonly [number, number, number]
  readonly prerelease: readonly string[]
}

function parseVersion(value: string): ParsedVersion | undefined {
  const matched = RELEASE_VERSION_PATTERN.exec(value)
  if (!matched) return undefined
  const [, major, minor, patch, prerelease] = matched
  const core = [Number(major), Number(minor), Number(patch)] as const
  if (!core.every(Number.isSafeInteger)) return undefined
  return { core, prerelease: prerelease ? prerelease.split('.') : [] }
}

function compareNumbers(left: number, right: number) {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function compareIdentifiers(left: string, right: string) {
  const leftNumeric = NUMERIC_IDENTIFIER_PATTERN.test(left)
  const rightNumeric = NUMERIC_IDENTIFIER_PATTERN.test(right)
  if (leftNumeric && rightNumeric) return compareNumbers(Number(left), Number(right))
  // A numeric identifier has lower precedence than an alphanumeric one.
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
  if (left === right) return 0
  return left < right ? -1 : 1
}

function comparePrerelease(left: readonly string[], right: readonly string[]) {
  // A version without a prerelease outranks the same version with one.
  if (left.length === 0 || right.length === 0) {
    return compareNumbers(right.length, left.length)
  }
  const shared = Math.min(left.length, right.length)
  for (let index = 0; index < shared; index += 1) {
    const order = compareIdentifiers(left[index] ?? '', right[index] ?? '')
    if (order !== 0) return order
  }
  return compareNumbers(left.length, right.length)
}

/** -1, 0 or 1 by semver precedence; `undefined` when either value is not a release version. */
export function compareUsageStatisticsVersions(left: string, right: string) {
  const parsedLeft = parseVersion(left)
  const parsedRight = parseVersion(right)
  if (!parsedLeft || !parsedRight) return undefined
  for (let index = 0; index < parsedLeft.core.length; index += 1) {
    const order = compareNumbers(parsedLeft.core[index] ?? 0, parsedRight.core[index] ?? 0)
    if (order !== 0) return order
  }
  return comparePrerelease(parsedLeft.prerelease, parsedRight.prerelease)
}

/** True only when `current` is a strictly higher release version than `previous`. */
export function isUsageStatisticsVersionUpgrade(previous: string, current: string) {
  return compareUsageStatisticsVersions(current, previous) === 1
}
