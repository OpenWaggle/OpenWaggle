import { pathToFileURL } from 'node:url'

const CLI_ARGUMENT_START_INDEX = 2
const EXPECTED_ARGUMENT_COUNT = 3
const RELEASE_PLEASE_BRANCH = 'release-please--branches--main'

export function validatePackageReleaseCandidate(input: Readonly<{
  artifactResult: string
  classificationResult: string
  headRef: string
}>) {
  if (input.classificationResult !== 'success') {
    throw new Error(`package release candidate classification did not succeed: ${input.classificationResult}.`)
  }

  const expectedArtifactResult = input.headRef === RELEASE_PLEASE_BRANCH
    ? 'success'
    : 'skipped'
  if (input.artifactResult !== expectedArtifactResult) {
    throw new Error(
      `package release candidate artifacts must be ${expectedArtifactResult} for ${input.headRef}: ${input.artifactResult}.`,
    )
  }
}

export function runPackageReleaseCandidateCli(args: readonly string[]) {
  if (args.length !== EXPECTED_ARGUMENT_COUNT) {
    throw new Error(
      'Usage: package-release-candidate-gate.ts <classification-result> <artifact-result> <head-ref>.',
    )
  }
  const [classificationResult, artifactResult, headRef] = args
  if (
    classificationResult === undefined ||
    artifactResult === undefined ||
    headRef === undefined
  ) {
    throw new Error('Package release candidate arguments are incomplete.')
  }
  validatePackageReleaseCandidate({ artifactResult, classificationResult, headRef })
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runPackageReleaseCandidateCli(process.argv.slice(CLI_ARGUMENT_START_INDEX))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
