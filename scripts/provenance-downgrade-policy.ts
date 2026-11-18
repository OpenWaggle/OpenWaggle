/**
 * Reviewed exceptions to the provenance downgrade check (scripts/check-provenance-downgrade.ts),
 * which replaced pnpm's `trustPolicy: no-downgrade`. Bun has no trust policy of its own.
 *
 * A locked version that lost the npm provenance its earlier releases had fails the check while it
 * is younger than {@link PROVENANCE_DOWNGRADE_WINDOW_DAYS} days. Add an exception only after
 * looking at why the provenance stopped, and record that reason here. An exception names a
 * package (every version) or one `name@version`; one that no locked package matches fails the
 * check, so exceptions cannot outlive their dependency.
 */

export interface ProvenanceDowngradeException {
  /** A package name, or `name@version` for one exact version. */
  readonly package: string
  readonly reason: string
}

/**
 * pnpm's `trustPolicyIgnoreAfter: 43200` (minutes): a release that has been public this long
 * without anyone flagging it is treated as established. With the seven-day `minimumReleaseAge`
 * in bunfig.toml, the check bites on releases between 7 and 30 days old.
 */
export const PROVENANCE_DOWNGRADE_WINDOW_DAYS = 30

const PIERRE_THEME_REASON =
  'Investigated in PR #145 (ADR 0016 adopted @pierre/diffs as the diff renderer, which pins ' +
  '@pierre/theme). @pierre/theme published SLSA provenance on every version ' +
  'from 0.0.20 through 1.0.3, then stopped at 1.1.0 (2026-06-26) and 2.0.0 (2026-07-24). The drop ' +
  'is scope-wide and consistent across @pierre/* rather than one version, and the scope publishes ' +
  '@pierre/diffs daily: a change of publish pipeline, not the single-version takeover this check ' +
  'hunts. Apache-2.0.'

export const PROVENANCE_DOWNGRADE_EXCEPTIONS: readonly ProvenanceDowngradeException[] = [
  { package: '@pierre/theme', reason: PIERRE_THEME_REASON },
]
