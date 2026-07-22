function addViolation(condition: boolean, message: string, violations: string[]) {
  if (condition) violations.push(message)
}

function requireText(
  source: string,
  requirements: readonly (readonly [string, string])[],
  violations: string[],
) {
  for (const [snippet, message] of requirements) {
    addViolation(!source.includes(snippet), message, violations)
  }
}

export function validatePackageReleaseProvenance(
  provenanceSource: string,
  violations: string[],
) {
  requireText(provenanceSource, [
    ['packageReleaseAttestationVerificationArgs', 'package-release-provenance.ts must define the GitHub attestation verification contract.'],
    ['--signer-workflow', 'package-release-provenance.ts must bind attestations to the trusted CI workflow.'],
    ['--deny-self-hosted-runners', 'package-release-provenance.ts must reject self-hosted attestation runners.'],
    ['runInvocationURI', 'package-release-provenance.ts must bind attestations to the selected CI run.'],
    ["runnerEnvironment !== 'github-hosted'", 'package-release-provenance.ts must require GitHub-hosted attestation identity.'],
    ['assertPackageReleaseAttestationSourceCommit', 'package-release-provenance.ts must validate the attested source commit.'],
    ['candidateSourceSha', 'package-release-provenance.ts must bind pull-request attestations to the candidate head.'],
    ['sourceTree', 'package-release-provenance.ts must bind attestations to the release source tree.'],
    ['git/commits/${attestationSourceSha}', 'package-release-provenance.ts must resolve the exact attested Git commit.'],
  ], violations)
  addViolation(
    provenanceSource.includes('--source-digest'),
    'package-release-provenance.ts must not assume a pull-request attestation uses the candidate head digest.',
    violations,
  )
}
