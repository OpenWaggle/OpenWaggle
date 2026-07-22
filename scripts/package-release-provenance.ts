import { execFile } from 'node:child_process'
import path from 'node:path'

export interface PackageReleaseAttestationIdentity {
  readonly repository: string
  readonly runId: string
}

interface PackageReleaseProvenanceInput extends PackageReleaseAttestationIdentity {
  readonly artifactFiles: readonly string[]
  readonly artifactRoot: string
  readonly candidateSourceSha: string
  readonly sourceTree: string
}

function isJsonObject(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function packageReleaseAttestationVerificationArgs(
  file: string,
  repository: string,
) {
  return [
    'attestation',
    'verify',
    file,
    '--repo',
    repository,
    '--signer-workflow',
    `${repository}/.github/workflows/ci.yml`,
    '--deny-self-hosted-runners',
    '--format',
    'json',
  ]
}

function attestationSourceSha(
  entry: unknown,
  expectedWorkflowPrefix: string,
  expectedRunPrefix: string,
) {
  if (
    !isJsonObject(entry) ||
    !isJsonObject(entry.verificationResult) ||
    !isJsonObject(entry.verificationResult.signature) ||
    !isJsonObject(entry.verificationResult.signature.certificate)
  ) {
    return undefined
  }
  const certificate = entry.verificationResult.signature.certificate
  if (
    typeof certificate.buildConfigURI !== 'string' ||
    !certificate.buildConfigURI.startsWith(expectedWorkflowPrefix) ||
    typeof certificate.runInvocationURI !== 'string' ||
    !certificate.runInvocationURI.startsWith(expectedRunPrefix) ||
    !/^\d+$/.test(certificate.runInvocationURI.slice(expectedRunPrefix.length)) ||
    certificate.runnerEnvironment !== 'github-hosted' ||
    typeof certificate.sourceRepositoryDigest !== 'string'
  ) {
    return undefined
  }
  return certificate.sourceRepositoryDigest
}

export function assertPackageReleaseAttestationIdentity(
  value: unknown,
  identity: PackageReleaseAttestationIdentity,
) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Artifact attestation verification returned no identity result.')
  }
  const expectedWorkflowPrefix =
    `https://github.com/${identity.repository}/.github/workflows/ci.yml@`
  const expectedRunPrefix =
    `https://github.com/${identity.repository}/actions/runs/${identity.runId}/attempts/`
  const sourceShas = new Set(
    value
      .map((entry) => attestationSourceSha(entry, expectedWorkflowPrefix, expectedRunPrefix))
      .filter((sourceSha) => sourceSha !== undefined),
  )
  if (sourceShas.size !== 1) {
    throw new Error('Artifact attestation does not match the selected CI run and source identity.')
  }
  const sourceSha = sourceShas.values().next().value
  if (sourceSha === undefined) {
    throw new Error('Artifact attestation source identity is unavailable.')
  }
  return sourceSha
}

export function assertPackageReleaseAttestationSourceCommit(
  value: unknown,
  identity: Readonly<{
    attestationSourceSha: string
    candidateSourceSha: string
    sourceTree: string
  }>,
) {
  if (
    !isJsonObject(value) ||
    value.sha !== identity.attestationSourceSha ||
    !isJsonObject(value.tree) ||
    value.tree.sha !== identity.sourceTree ||
    !Array.isArray(value.parents) ||
    !value.parents.every((parent) => isJsonObject(parent) && typeof parent.sha === 'string') ||
    (identity.attestationSourceSha !== identity.candidateSourceSha &&
      !value.parents.some(
        (parent) => isJsonObject(parent) && parent.sha === identity.candidateSourceSha,
      ))
  ) {
    throw new Error('Attested source commit does not match the candidate head and source tree.')
  }
}

function runGh(args: readonly string[]) {
  return new Promise<unknown>((resolve, reject) => {
    execFile('gh', args, { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error !== null) {
        reject(new Error(stderr.trim() || error.message))
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch (parseError) {
        reject(parseError)
      }
    })
  })
}

export async function verifyPackageReleaseArtifactProvenance(
  input: PackageReleaseProvenanceInput,
) {
  const sourceShas = new Set<string>()
  for (const artifactFile of input.artifactFiles) {
    const verification = await runGh(
      packageReleaseAttestationVerificationArgs(
        path.join(input.artifactRoot, artifactFile),
        input.repository,
      ),
    )
    sourceShas.add(assertPackageReleaseAttestationIdentity(verification, input))
  }
  if (sourceShas.size !== 1) {
    throw new Error('Package artifacts do not share one attested source commit.')
  }
  const attestationSourceSha = sourceShas.values().next().value
  if (attestationSourceSha === undefined) {
    throw new Error('Package artifact attestation source is unavailable.')
  }
  const sourceCommit = await runGh([
    'api',
    `repos/${input.repository}/git/commits/${attestationSourceSha}`,
  ])
  assertPackageReleaseAttestationSourceCommit(sourceCommit, {
    attestationSourceSha,
    candidateSourceSha: input.candidateSourceSha,
    sourceTree: input.sourceTree,
  })
}
