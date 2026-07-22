import { pathToFileURL } from 'node:url'

const CLI_ARGUMENT_START_INDEX = 2
const EXPECTED_ARGUMENT_COUNT = 6
const RELEASE_PLEASE_BRANCH_PREFIX = 'release-please--branches--main'

export function validatePackageReleaseGate(input: Readonly<{
  artifactResult: string
  checkResult: string
  commitPolicyResult: string
  headRef: string
  rehearsalResult: string
  testResult: string
}>) {
  const requiredResults = [
    ['commit policy', input.commitPolicyResult],
    ['typecheck and lint', input.checkResult],
    ['unit and component tests', input.testResult],
    ['package release rehearsal', input.rehearsalResult],
  ] as const
  for (const [name, result] of requiredResults) {
    if (result !== 'success') {
      throw new Error(`${name} did not succeed: ${result}.`)
    }
  }
  if (
    input.headRef.startsWith(RELEASE_PLEASE_BRANCH_PREFIX) &&
    input.artifactResult !== 'success'
  ) {
    throw new Error('Release Please PRs require immutable package artifacts and provenance.')
  }
}

export function runPackageReleaseGateCli(args: readonly string[]) {
  if (args.length !== EXPECTED_ARGUMENT_COUNT) {
    throw new Error(
      'Usage: package-release-gate.ts <commit-policy-result> <check-result> <test-result> <rehearsal-result> <artifact-result> <head-ref>.',
    )
  }
  const [commitPolicyResult, checkResult, testResult, rehearsalResult, artifactResult, headRef] = args
  if (
    commitPolicyResult === undefined ||
    checkResult === undefined ||
    testResult === undefined ||
    rehearsalResult === undefined ||
    artifactResult === undefined ||
    headRef === undefined
  ) {
    throw new Error('Package release gate arguments are incomplete.')
  }
  validatePackageReleaseGate({
    artifactResult,
    checkResult,
    commitPolicyResult,
    headRef,
    rehearsalResult,
    testResult,
  })
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runPackageReleaseGateCli(process.argv.slice(CLI_ARGUMENT_START_INDEX))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
