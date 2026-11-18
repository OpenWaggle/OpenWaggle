import { parseMinimumReleaseAgeExcludes } from './support/bun-workspace'

/** The repository's Bun release-age exceptions (`bunfig.toml`), which consumer smokes reuse. */
export function parseMinimumReleaseAgeExclusions(bunfig: string) {
  return parseMinimumReleaseAgeExcludes(bunfig)
}

export function createYarnTrustPolicy(exclusions: readonly string[]) {
  return [
    'nodeLinker: node-modules',
    '',
    'npmPreapprovedPackages:',
    ...exclusions.map((exclusion) => `  - ${JSON.stringify(exclusion)}`),
    '',
  ].join('\n')
}
