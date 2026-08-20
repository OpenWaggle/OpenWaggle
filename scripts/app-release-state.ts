import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Schema } from 'effect'

const ARG_VALUE_OFFSET = 1
const CLI_COMMAND_INDEX = 2
const JSON_INDENT = 2
const RELEASE_SUBJECT_PATTERN =
  /^chore\(release\): v([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)(?: \(#[0-9]+\))?$/u

const pullRequestSchema = Schema.Struct({
  baseRefName: Schema.String,
  headRefName: Schema.String,
  headRefOid: Schema.String,
  headRepository: Schema.Struct({ name: Schema.String }),
  headRepositoryOwner: Schema.Struct({ login: Schema.String }),
  isCrossRepository: Schema.Boolean,
  mergeCommit: Schema.NullOr(Schema.Struct({ oid: Schema.String })),
  number: Schema.Number,
  state: Schema.String,
  title: Schema.String,
  url: Schema.String,
})
const pullRequestListJsonSchema = Schema.parseJson(Schema.Array(pullRequestSchema))
const manifestJsonSchema = Schema.parseJson(
  Schema.Record({ key: Schema.String, value: Schema.Unknown }),
)

export type AppReleasePullRequest = typeof pullRequestSchema.Type

export interface ReleasePullRequestIdentity {
  readonly branch: string
  readonly owner: string
  readonly repository: string
}

export function selectOwnedReleasePullRequests(
  pullRequests: readonly AppReleasePullRequest[],
  identity: ReleasePullRequestIdentity,
) {
  return pullRequests.filter(
    (pullRequest) =>
      pullRequest.isCrossRepository === false &&
      pullRequest.headRepositoryOwner.login === identity.owner &&
      pullRequest.headRepository.name === identity.repository &&
      pullRequest.headRefName === identity.branch,
  )
}

export function expectedVersionOnlyManifest(baseManifestJson: string, version: string) {
  const manifest = Schema.decodeUnknownSync(manifestJsonSchema)(baseManifestJson)
  return `${JSON.stringify({ ...manifest, version }, null, JSON_INDENT)}\n`
}

export function releaseSubjectVersion(subject: string) {
  return RELEASE_SUBJECT_PATTERN.exec(subject)?.[1] ?? null
}

function argument(name: string) {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + ARG_VALUE_OFFSET] : undefined
  if (!value) {
    throw new Error(`Missing required argument ${name}.`)
  }
  return value
}

async function readStandardInput() {
  process.stdin.setEncoding('utf8')
  let input = ''
  for await (const chunk of process.stdin) {
    input += String(chunk)
  }
  return input
}

async function runCli() {
  const command = process.argv[CLI_COMMAND_INDEX]
  if (command === 'filter-prs') {
    const pullRequests = Schema.decodeUnknownSync(pullRequestListJsonSchema)(
      await readStandardInput(),
    )
    const selected = selectOwnedReleasePullRequests(pullRequests, {
      branch: argument('--branch'),
      owner: argument('--owner'),
      repository: argument('--repository'),
    })
    process.stdout.write(JSON.stringify(selected))
    return
  }

  if (command === 'expected-manifest') {
    const basePath = argument('--base')
    const outputPath = argument('--output')
    const version = argument('--version')
    const expected = expectedVersionOnlyManifest(fs.readFileSync(basePath, 'utf8'), version)
    fs.writeFileSync(outputPath, expected)
    return
  }

  if (command === 'release-subject-version') {
    const version = releaseSubjectVersion(argument('--subject'))
    if (!version) {
      throw new Error('Commit subject is not a release subject.')
    }
    process.stdout.write(version)
    return
  }

  throw new Error(`Unsupported app release state command: ${String(command)}.`)
}

const entryPath = process.argv[1]
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  void runCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
