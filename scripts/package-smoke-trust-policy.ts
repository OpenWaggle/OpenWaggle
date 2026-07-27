import { isMap, isScalar, isSeq, parseDocument } from 'yaml'

const MINIMUM_RELEASE_AGE_EXCLUDE_KEY = 'minimumReleaseAgeExclude'

export function parseMinimumReleaseAgeExclusions(workspaceConfig: string) {
  const document = parseDocument(workspaceConfig, {
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  })
  if (document.errors.length > 0 || !isMap(document.contents)) {
    throw new Error('pnpm-workspace.yaml must contain a valid mapping.')
  }

  const exclusionsNode = document.contents.items.find(
    (pair) => isScalar(pair.key) && pair.key.value === MINIMUM_RELEASE_AGE_EXCLUDE_KEY,
  )?.value
  if (!isSeq(exclusionsNode)) {
    throw new Error('pnpm-workspace.yaml must define minimumReleaseAgeExclude as a sequence.')
  }

  return exclusionsNode.items.map((item) => {
    if (!isScalar(item) || typeof item.value !== 'string') {
      throw new Error('minimumReleaseAgeExclude entries must be strings.')
    }
    return item.value
  })
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
