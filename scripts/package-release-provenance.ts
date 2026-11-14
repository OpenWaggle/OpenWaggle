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

/*
 * This module runs under plain Node with no install (package-release-promote.ts loads it), so it
 * checks its JSON with local type guards instead of the shared schemas.
 */
function isJsonObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface SigstoreCertificate {
  readonly buildConfigURI: string
  readonly runInvocationURI: string
  readonly runnerEnvironment: unknown
  readonly sourceRepositoryDigest: string
}

function isSigstoreCertificate(value: unknown): value is SigstoreCertificate {
  return (
    isJsonObject(value) &&
    'buildConfigURI' in value &&
    typeof value.buildConfigURI === 'string' &&
    'runInvocationURI' in value &&
    typeof value.runInvocationURI === 'string' &&
    'runnerEnvironment' in value &&
    'sourceRepositoryDigest' in value &&
    typeof value.sourceRepositoryDigest === 'string'
  )
}

/** The certificate of one `gh attestation verify --format json` entry. */
function attestationCertificate(entry: unknown) {
  if (!isJsonObject(entry) || !('verificationResult' in entry)) return undefined
  const result = entry.verificationResult
  if (!isJsonObject(result) || !('signature' in result)) return undefined
  const signature = result.signature
  if (!isJsonObject(signature) || !('certificate' in signature)) return undefined
  return isSigstoreCertificate(signature.certificate) ? signature.certificate : undefined
}

function shaOf(value: unknown) {
  return isJsonObject(value) && 'sha' in value && typeof value.sha === 'string'
    ? value.sha
    : undefined
}

interface GitCommitRecord {
  readonly sha: unknown
  readonly tree: unknown
  readonly parents: readonly unknown[]
}

function isGitCommitRecord(value: unknown): value is GitCommitRecord {
  return (
    isJsonObject(value) &&
    'sha' in value &&
    'tree' in value &&
    'parents' in value &&
    Array.isArray(value.parents)
  )
}

export function packageReleaseAttestationVerificationArgs(file: string, repository: string) {
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
  const certificate = attestationCertificate(entry)
  if (
    certificate === undefined ||
    !certificate.buildConfigURI.startsWith(expectedWorkflowPrefix) ||
    !certificate.runInvocationURI.startsWith(expectedRunPrefix) ||
    !/^\d+$/.test(certificate.runInvocationURI.slice(expectedRunPrefix.length)) ||
    certificate.runnerEnvironment !== 'github-hosted'
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
  const expectedWorkflowPrefix = `https://github.com/${identity.repository}/.github/workflows/ci.yml@`
  const expectedRunPrefix = `https://github.com/${identity.repository}/actions/runs/${identity.runId}/attempts/`
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
    !isGitCommitRecord(value) ||
    value.sha !== identity.attestationSourceSha ||
    shaOf(value.tree) !== identity.sourceTree ||
    !value.parents.every((parent) => shaOf(parent) !== undefined) ||
    (identity.attestationSourceSha !== identity.candidateSourceSha &&
      !value.parents.some((parent) => shaOf(parent) === identity.candidateSourceSha))
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

export async function verifyPackageReleaseArtifactProvenance(input: PackageReleaseProvenanceInput) {
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
