import { execFileSync } from 'node:child_process'
import { prepareAppRelease } from './app-release-intent'

export interface VerifyGeneratedAppReleaseTreeInput {
  readonly candidateRef: string
  readonly projectRoot: string
  readonly version: string
}

function git(projectRoot: string, ...args: readonly string[]) {
  return execFileSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

export function verifyGeneratedAppReleaseTree(
  input: VerifyGeneratedAppReleaseTreeInput,
) {
  const releaseDate = git(input.projectRoot, 'show', '-s', '--format=%as', 'HEAD')
  prepareAppRelease(input.projectRoot, input.version, releaseDate)
  git(input.projectRoot, 'add', '--all')

  const expectedTree = git(input.projectRoot, 'write-tree')
  const candidateTree = git(
    input.projectRoot,
    'rev-parse',
    `${input.candidateRef}^{tree}`,
  )
  if (expectedTree !== candidateTree) {
    throw new Error(
      `Release candidate tree ${candidateTree} does not match regenerated tree ${expectedTree}.`,
    )
  }

  return { candidateTree, expectedTree, releaseDate }
}
