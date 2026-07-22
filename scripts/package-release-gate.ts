import { pathToFileURL } from 'node:url'

const CLI_ARGUMENT_START_INDEX = 2
const EXPECTED_ARGUMENT_COUNT = 5

export function validatePackageReleaseGate(input: Readonly<{
  candidateResult: string
  checkResult: string
  commitPolicyResult: string
  rehearsalResult: string
  testResult: string
}>) {
  const requiredResults = [
    ['commit policy', input.commitPolicyResult],
    ['typecheck and lint', input.checkResult],
    ['unit and component tests', input.testResult],
    ['package release rehearsal', input.rehearsalResult],
    ['package release candidate', input.candidateResult],
  ] as const
  for (const [name, result] of requiredResults) {
    if (result !== 'success') {
      throw new Error(`${name} did not succeed: ${result}.`)
    }
  }
}

export function runPackageReleaseGateCli(args: readonly string[]) {
  if (args.length !== EXPECTED_ARGUMENT_COUNT) {
    throw new Error(
      'Usage: package-release-gate.ts <commit-policy-result> <check-result> <test-result> <rehearsal-result> <candidate-result>.',
    )
  }
  const [commitPolicyResult, checkResult, testResult, rehearsalResult, candidateResult] = args
  if (
    commitPolicyResult === undefined ||
    checkResult === undefined ||
    testResult === undefined ||
    rehearsalResult === undefined ||
    candidateResult === undefined
  ) {
    throw new Error('Package release gate arguments are incomplete.')
  }
  validatePackageReleaseGate({
    candidateResult,
    checkResult,
    commitPolicyResult,
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
