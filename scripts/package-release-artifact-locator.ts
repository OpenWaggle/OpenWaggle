import { execFile } from 'node:child_process'
import { appendFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const CLI_ARGUMENT_START_INDEX = 2
const EXPECTED_ARGUMENT_COUNT = 1

export interface PackageReleaseArtifactCandidate {
  readonly createdAt: string
  readonly expired: boolean
  readonly name: string
  readonly runId: number
  readonly sourceSha: string
}

export interface PackageReleaseWorkflowRun {
  readonly conclusion: string
  readonly event: string
  readonly headSha: string
  readonly path: string
}

type ReadWorkflowRun = (runId: number) => Promise<PackageReleaseWorkflowRun>

export function packageReleaseArtifactRunEnvironment(
  selection: Readonly<{ runId: number; sourceSha: string }>,
) {
  return `EXPECTED_ARTIFACT_RUN_ID=${String(selection.runId)}\n`
}

function isPackageReleaseArtifactEvent(event: string) {
  return event === 'pull_request' || event === 'workflow_dispatch'
}

export async function selectPackageReleaseArtifactRun(
  artifactName: string,
  candidates: readonly PackageReleaseArtifactCandidate[],
  readWorkflowRun: ReadWorkflowRun,
) {
  const ordered = candidates
    .filter((candidate) => !candidate.expired && candidate.name === artifactName)
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))
  for (const candidate of ordered) {
    const run = await readWorkflowRun(candidate.runId)
    if (
      run.conclusion === 'success' &&
      isPackageReleaseArtifactEvent(run.event) &&
      run.path === '.github/workflows/ci.yml' &&
      run.headSha === candidate.sourceSha
    ) {
      return { runId: candidate.runId, sourceSha: candidate.sourceSha }
    }
  }
  throw new Error(`No exact successful release-candidate CI artifact exists for ${artifactName}.`)
}

function runGhApi(endpoint: string) {
  return new Promise<unknown>((resolve, reject) => {
    execFile('gh', ['api', endpoint], { encoding: 'utf8' }, (error, stdout, stderr) => {
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

/*
 * This script runs under plain Node with no install, so it checks its JSON with local type guards
 * and reads its environment by destructuring `process.env`, instead of the shared schemas.
 */
function isJsonObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function artifactsOf(value: unknown) {
  return isJsonObject(value) && 'artifacts' in value && Array.isArray(value.artifacts)
    ? value.artifacts
    : undefined
}

interface ArtifactRecord {
  readonly name: string
  readonly expired: boolean
  readonly created_at: string
  readonly workflow_run: unknown
}

function isArtifactRecord(value: unknown): value is ArtifactRecord {
  return (
    isJsonObject(value) &&
    'name' in value &&
    typeof value.name === 'string' &&
    'expired' in value &&
    typeof value.expired === 'boolean' &&
    'created_at' in value &&
    typeof value.created_at === 'string' &&
    'workflow_run' in value
  )
}

function artifactWorkflowRun(value: unknown) {
  if (!isJsonObject(value) || !('id' in value) || !('head_sha' in value)) return undefined
  const { id, head_sha: headSha } = value
  return typeof id === 'number' && typeof headSha === 'string' ? { id, headSha } : undefined
}

function decodeCandidates(value: unknown) {
  const artifacts = artifactsOf(value)
  if (artifacts === undefined) {
    throw new Error('GitHub returned an invalid artifact list.')
  }
  const candidate: readonly PackageReleaseArtifactCandidate[] = artifacts.map(
    (artifact: unknown) => {
      const run = isArtifactRecord(artifact)
        ? artifactWorkflowRun(artifact.workflow_run)
        : undefined
      if (!isArtifactRecord(artifact) || run === undefined) {
        throw new Error('GitHub returned an invalid package release artifact.')
      }
      return {
        createdAt: artifact.created_at,
        expired: artifact.expired,
        name: artifact.name,
        runId: run.id,
        sourceSha: run.headSha,
      }
    },
  )
  return candidate
}

interface WorkflowRunRecord {
  readonly conclusion: string
  readonly event: string
  readonly head_sha: string
  readonly path: string
}

function isWorkflowRunRecord(value: unknown): value is WorkflowRunRecord {
  return (
    isJsonObject(value) &&
    'conclusion' in value &&
    typeof value.conclusion === 'string' &&
    'event' in value &&
    typeof value.event === 'string' &&
    'head_sha' in value &&
    typeof value.head_sha === 'string' &&
    'path' in value &&
    typeof value.path === 'string'
  )
}

function decodeWorkflowRun(value: unknown) {
  if (!isWorkflowRunRecord(value)) {
    throw new Error('GitHub returned an invalid workflow run.')
  }
  const run: PackageReleaseWorkflowRun = {
    conclusion: value.conclusion,
    event: value.event,
    headSha: value.head_sha,
    path: value.path,
  }
  return run
}

export async function locatePackageReleaseArtifact(args: readonly string[]) {
  if (args.length !== EXPECTED_ARGUMENT_COUNT) {
    throw new Error('Usage: package-release-artifact-locator.ts <source-tree>.')
  }
  const sourceTree = args[0]
  const {
    GITHUB_REPOSITORY: repository,
    GITHUB_ENV: githubEnvironment,
    GITHUB_OUTPUT: githubOutput,
  } = process.env
  if (
    sourceTree === undefined ||
    repository === undefined ||
    githubEnvironment === undefined ||
    githubOutput === undefined
  ) {
    throw new Error('Package release artifact locator environment is incomplete.')
  }
  const artifactName = `package-release-${sourceTree}`
  const candidates = decodeCandidates(
    await runGhApi(`repos/${repository}/actions/artifacts?name=${artifactName}&per_page=100`),
  )
  const selection = await selectPackageReleaseArtifactRun(artifactName, candidates, async (runId) =>
    decodeWorkflowRun(await runGhApi(`repos/${repository}/actions/runs/${runId}`)),
  )
  await appendFile(githubOutput, `run_id=${String(selection.runId)}\n`)
  await appendFile(githubOutput, `source_sha=${selection.sourceSha}\n`)
  await appendFile(githubOutput, `artifact_name=${artifactName}\n`)
  await appendFile(githubEnvironment, packageReleaseArtifactRunEnvironment(selection))
  return selection
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void locatePackageReleaseArtifact(process.argv.slice(CLI_ARGUMENT_START_INDEX)).catch(
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    },
  )
}
