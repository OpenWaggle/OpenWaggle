import { parse as parseYaml } from 'yaml'

/** What the release-age exclusion check reads of `pnpm-workspace.yaml` and the clock. */
interface ReleaseAgeInput {
  readonly workspace: string
  readonly now: Date
}

/**
 * Temporary Pi entries in `minimumReleaseAgeExclude` must name when the last-published package of
 * the excluded release passes pnpm's seven-day minimum release age, and the check fails from then
 * on, so the exceptions cannot linger after they stop being needed.
 */
const RELEASE_AGE_EXPIRY_MARKER = 'pi-runtime-release-age-exclusions-expire'

/** A matched-release package name and one exact version, such as `pi-ai` and `1.2.0`. */
const EXACT_PI_PACKAGE = /^@earendil-works\/(?:pi-[a-z0-9-]+|chord)$/
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

/**
 * The `@earendil-works/` items of `minimumReleaseAgeExclude`, read as YAML (quotes and trailing
 * comments included). pnpm reads `name@1.2.0 || 1.2.1` as one exclusion per version, so a union
 * becomes one entry per version; an item that is not one package at exact versions is inexact.
 */
function piReleaseAgeEntries(workspace: string) {
  let parsed: unknown
  try {
    parsed = parseYaml(workspace)
  } catch (error) {
    return { exact: [], inexact: [], invalid: error instanceof Error ? error.message : String(error) }
  }
  const list: unknown =
    typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'minimumReleaseAgeExclude') : undefined
  const items = Array.isArray(list) ? list.filter((item) => typeof item === 'string') : []
  const exact: string[] = []
  const inexact: string[] = []
  for (const item of items.filter((candidate) => candidate.startsWith('@earendil-works/'))) {
    const separator = item.indexOf('@', 1)
    const name = separator > 0 ? item.slice(0, separator) : item
    const versions = separator > 0 ? item.slice(separator + 1).split('||').map((part) => part.trim()) : []
    if (!EXACT_PI_PACKAGE.test(name) || versions.length === 0 || !versions.every((part) => EXACT_VERSION.test(part))) {
      inexact.push(item)
    } else {
      exact.push(...versions.map((part) => `${name}@${part}`))
    }
  }
  return { exact, inexact, invalid: undefined }
}

/**
 * Temporary exceptions cover exactly the matched-release packages the lockfile resolves, each at
 * one exact version: one for a package nothing installs exempts nothing and
 * only lingers, and a wildcard or range would exempt every later Pi release from every check.
 */
export function releaseAgeExclusionProblems(
  input: ReleaseAgeInput,
  version: string,
  /** `<package>@<version>` of every matched-release package the lockfile resolves. */
  expected: ReadonlySet<string>,
) {
  const { exact, inexact, invalid } = piReleaseAgeEntries(input.workspace)
  if (invalid) return [`pnpm-workspace.yaml is not valid YAML: ${invalid}`]
  const inexactProblems = inexact.length
    ? [`minimumReleaseAgeExclude may name Pi packages only at one exact version: ${inexact.join(', ')}.`]
    : []
  const ageEntries = new Set(exact)
  if (ageEntries.size === 0) {
    // The marker only dates entries; once they are gone it would claim exclusions that do not exist.
    return input.workspace.includes(`# ${RELEASE_AGE_EXPIRY_MARKER}`)
      ? [
          ...inexactProblems,
          `The ${RELEASE_AGE_EXPIRY_MARKER} line has no Pi minimumReleaseAgeExclude entries left to date; remove it.`,
        ]
      : inexactProblems
  }
  const missing = [...expected].filter((entry) => !ageEntries.has(entry))
  const unneeded = [...ageEntries].filter((entry) => !expected.has(entry))
  const problems: string[] = [...inexactProblems]
  if (missing.length > 0 || unneeded.length > 0) {
    problems.push(
      `minimumReleaseAgeExclude must be empty or contain exactly the ${expected.size} matched Pi packages the lockfile resolves at ${version}: ${[
        ...missing.map((entry) => `missing ${entry}`),
        ...unneeded.map((entry) => `unneeded ${entry}`),
      ].join(', ')}.`,
    )
  }
  return [...problems, ...releaseAgeExclusionExpiryProblems(input, version)]
}

function releaseAgeExclusionExpiryProblems(input: ReleaseAgeInput, version: string) {
  const pattern = `^\\s*# ${RELEASE_AGE_EXPIRY_MARKER}: (\\d{4}-\\d{2}-\\d{2})(T\\d{2}:\\d{2}:\\d{2}Z)?$`
  const [, date, time] = input.workspace.match(new RegExp(pattern, 'm')) ?? []
  // A bare date is midnight UTC; a rolled-over date such as 2026-02-30 does not round-trip.
  const expiry = date && `${date}${time ?? 'T00:00:00Z'}`
  const expiryTime = expiry ? Date.parse(expiry) : Number.NaN
  if (!expiry || Number.isNaN(expiryTime) || new Date(expiryTime).toISOString().replace('.000Z', 'Z') !== expiry) {
    return [
      `Temporary Pi minimumReleaseAgeExclude entries need a "# ${RELEASE_AGE_EXPIRY_MARKER}: YYYY-MM-DD" or "YYYY-MM-DDTHH:MM:SSZ" line naming when every ${version} package is seven days old.`,
    ]
  }
  if (input.now.getTime() >= expiryTime) {
    return [
      `Remove the temporary Pi minimumReleaseAgeExclude entries and their ${RELEASE_AGE_EXPIRY_MARKER} line: Pi ${version} passed pnpm's seven-day minimum release age at ${expiry}.`,
    ]
  }
  return []
}
