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

function isJsonObject(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decodeCandidates(value: unknown): readonly PackageReleaseArtifactCandidate[] {
  if (!isJsonObject(value) || !Array.isArray(value.artifacts)) {
    throw new Error('GitHub returned an invalid artifact list.')
  }
  return value.artifacts.map((artifact) => {
    if (
      !isJsonObject(artifact) ||
      typeof artifact.name !== 'string' ||
      typeof artifact.expired !== 'boolean' ||
      typeof artifact.created_at !== 'string' ||
      !isJsonObject(artifact.workflow_run) ||
      typeof artifact.workflow_run.id !== 'number' ||
      typeof artifact.workflow_run.head_sha !== 'string'
    ) {
      throw new Error('GitHub returned an invalid package release artifact.')
    }
    return {
      createdAt: artifact.created_at,
      expired: artifact.expired,
      name: artifact.name,
      runId: artifact.workflow_run.id,
      sourceSha: artifact.workflow_run.head_sha,
    }
  })
}

function decodeWorkflowRun(value: unknown): PackageReleaseWorkflowRun {
  if (
    !isJsonObject(value) ||
    typeof value.conclusion !== 'string' ||
    typeof value.event !== 'string' ||
    typeof value.head_sha !== 'string' ||
    typeof value.path !== 'string'
  ) {
    throw new Error('GitHub returned an invalid workflow run.')
  }
  return {
    conclusion: value.conclusion,
    event: value.event,
    headSha: value.head_sha,
    path: value.path,
  }
}

export async function locatePackageReleaseArtifact(args: readonly string[]) {
  if (args.length !== EXPECTED_ARGUMENT_COUNT) {
    throw new Error('Usage: package-release-artifact-locator.ts <source-tree>.')
  }
  const sourceTree = args[0]
  const repository = process.env.GITHUB_REPOSITORY
  const githubOutput = process.env.GITHUB_OUTPUT
  if (sourceTree === undefined || repository === undefined || githubOutput === undefined) {
    throw new Error('Package release artifact locator environment is incomplete.')
  }
  const artifactName = `package-release-${sourceTree}`
  const candidates = decodeCandidates(
    await runGhApi(`repos/${repository}/actions/artifacts?name=${artifactName}&per_page=100`),
  )
  const selection = await selectPackageReleaseArtifactRun(
    artifactName,
    candidates,
    async (runId) =>
      decodeWorkflowRun(await runGhApi(`repos/${repository}/actions/runs/${runId}`)),
  )
  await appendFile(githubOutput, `run_id=${String(selection.runId)}\n`)
  await appendFile(githubOutput, `source_sha=${selection.sourceSha}\n`)
  await appendFile(githubOutput, `artifact_name=${artifactName}\n`)
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
