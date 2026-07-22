import { execFile } from 'node:child_process'
import { appendFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const CLI_ARGUMENT_START_INDEX = 2
const EXPECTED_CLI_ARGUMENT_COUNT = 5
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/

interface PackageReleaseContextInput {
  readonly eventBefore: string
  readonly eventName: string
  readonly eventSha: string
  readonly recoveryReleaseSha: string
  readonly ref: string
}

interface PackageReleaseContextDependencies {
  readonly isAncestorOfMain: (sha: string) => Promise<boolean>
  readonly readFirstParent: (sha: string) => Promise<string>
  readonly resolveCommit: (sha: string) => Promise<string>
}

export interface PackageReleaseContext {
  readonly beforeSha: string
  readonly sourceSha: string
}

function assertCommitSha(value: string, label: string) {
  if (!COMMIT_SHA_PATTERN.test(value)) {
    throw new Error(`${label} must be a canonical 40-character commit SHA.`)
  }
}

export async function resolvePackageReleaseContext(
  input: PackageReleaseContextInput,
  dependencies: PackageReleaseContextDependencies,
): Promise<PackageReleaseContext> {
  if (input.ref !== 'refs/heads/main') {
    throw new Error('Package releases must run from main.')
  }
  if (input.eventName === 'push') {
    assertCommitSha(input.eventBefore, 'Push before SHA')
    assertCommitSha(input.eventSha, 'Push source SHA')
    return { beforeSha: input.eventBefore, sourceSha: input.eventSha }
  }
  if (input.eventName !== 'workflow_dispatch') {
    throw new Error(`Unsupported package release event: ${input.eventName}.`)
  }
  assertCommitSha(input.recoveryReleaseSha, 'Recovery release SHA')
  const sourceSha = await dependencies.resolveCommit(input.recoveryReleaseSha)
  if (sourceSha !== input.recoveryReleaseSha) {
    throw new Error('Recovery release SHA did not resolve to the exact requested commit.')
  }
  if (!(await dependencies.isAncestorOfMain(sourceSha))) {
    throw new Error('Recovery release SHA must be reachable from origin/main.')
  }
  const beforeSha = await dependencies.readFirstParent(sourceSha)
  assertCommitSha(beforeSha, 'Recovery release parent SHA')
  return { beforeSha, sourceSha }
}

function runGit(args: readonly string[], allowFailure = false) {
  return new Promise<Readonly<{ exitCode: number; stdout: string }>>((resolve, reject) => {
    execFile('git', args, { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error !== null && !allowFailure) {
        reject(new Error(stderr.trim() || error.message))
        return
      }
      resolve({ exitCode: error === null ? 0 : 1, stdout: stdout.trim() })
    })
  })
}

async function createDependencies(): Promise<PackageReleaseContextDependencies> {
  return {
    isAncestorOfMain: async (sha) =>
      (await runGit(['merge-base', '--is-ancestor', sha, 'origin/main'], true)).exitCode === 0,
    readFirstParent: async (sha) => {
      const result = await runGit(['rev-parse', `${sha}^1`])
      return result.stdout
    },
    resolveCommit: async (sha) => {
      const result = await runGit(['rev-parse', `${sha}^{commit}`])
      return result.stdout
    },
  }
}

export async function runPackageReleaseContextCli(args: readonly string[]) {
  if (args.length !== EXPECTED_CLI_ARGUMENT_COUNT) {
    throw new Error(
      'Usage: package-release-context.ts <event-name> <event-before> <event-sha> <recovery-release-sha> <ref>.',
    )
  }
  const [eventName, eventBefore, eventSha, recoveryReleaseSha, ref] = args
  if (
    eventName === undefined ||
    eventBefore === undefined ||
    eventSha === undefined ||
    recoveryReleaseSha === undefined ||
    ref === undefined
  ) {
    throw new Error('Package release context arguments are incomplete.')
  }
  const context = await resolvePackageReleaseContext(
    { eventBefore, eventName, eventSha, recoveryReleaseSha, ref },
    await createDependencies(),
  )
  const githubOutput = process.env.GITHUB_OUTPUT
  if (githubOutput !== undefined) {
    await appendFile(githubOutput, `before_sha=${context.beforeSha}\nsource_sha=${context.sourceSha}\n`)
  }
  return context
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runPackageReleaseContextCli(process.argv.slice(CLI_ARGUMENT_START_INDEX)).catch(
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    },
  )
}
