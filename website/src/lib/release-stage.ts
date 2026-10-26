/**
 * The release stage the landing page shows, derived from the app version on `main` (the root
 * package.json, which the release PR bumps) so the badge follows every promotion and disappears at
 * Stable. Stages follow docs/release-and-versioning.md: `X.Y.Z-<stage>.N` for Alpha, Beta and RC.
 */
const STAGE_LABELS: ReadonlyMap<string, string> = new Map([
  ['alpha', 'Alpha'],
  ['beta', 'Beta'],
  ['rc', 'Release candidate'],
]);

const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-(?<stage>[0-9A-Za-z-]+)(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z.-]+)?$/u;

/** The badge label for a prerelease version, or `undefined` for a Stable one. Throws otherwise. */
export function releaseStageLabel(version: string): string | undefined {
  const match = RELEASE_VERSION.exec(version);
  if (match === null) throw new Error(`Cannot read a release stage from version "${version}"`);
  const stage = match.groups?.stage;
  if (stage === undefined) return undefined;
  const label = STAGE_LABELS.get(stage);
  if (label === undefined) throw new Error(`Unknown release stage "${stage}" in version "${version}"`);
  return label;
}
