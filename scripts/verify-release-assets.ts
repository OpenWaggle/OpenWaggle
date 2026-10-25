/**
 * Verifies a GitHub Release against the assets the release job built (docs/release-and-versioning.md,
 * "CI/CD"). The job uploads to a draft, runs this, publishes, then runs it again with `--published`,
 * so update checks never see a published release whose metadata is still missing. Every built file
 * must be on the release with the same size and an `uploaded` state, nothing else may be there, and
 * the update metadata (`*.yml`) and `SHA256SUMS.txt` must match byte for byte.
 *
 * Dependency-free on purpose: the release job runs it with Node's built-in type stripping.
 *
 *   node scripts/verify-release-assets.ts --repo OpenWaggle/OpenWaggle --tag v1.0.0 --dir release [--published]
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export interface LocalReleaseAsset {
  readonly name: string
  readonly size: number
  readonly sha256: string
}

export interface RemoteReleaseAsset {
  readonly id: number
  readonly name: string
  readonly size: number
  readonly state: string
}

export interface RemoteRelease {
  readonly draft: boolean
  readonly assets: readonly RemoteReleaseAsset[]
}

const UPLOADED_STATE = 'uploaded'
const CHECKSUMS_FILE = 'SHA256SUMS.txt'
const UPDATE_METADATA_SUFFIX = '.yml'
const GH_MAX_BUFFER_BYTES = 256 * 1024 * 1024
const FIRST_CLI_ARGUMENT = 2
const ARGUMENT_VALUE_OFFSET = 1

function isByteVerified(name: string) {
  return name === CHECKSUMS_FILE || name.endsWith(UPDATE_METADATA_SUFFIX)
}

export function compareReleaseAssets(local: readonly LocalReleaseAsset[], remote: readonly RemoteReleaseAsset[]) {
  const problems: string[] = []
  const remoteByName = new Map(remote.map((asset) => [asset.name, asset]))
  for (const asset of local) {
    const uploaded = remoteByName.get(asset.name)
    if (uploaded === undefined) {
      problems.push(`${asset.name} is missing from the release`)
      continue
    }
    if (uploaded.state !== UPLOADED_STATE) {
      problems.push(`${asset.name} is ${uploaded.state} on the release, not ${UPLOADED_STATE}`)
      continue
    }
    if (uploaded.size !== asset.size) {
      problems.push(`${asset.name} is ${uploaded.size} bytes on the release, ${asset.size} bytes locally`)
    }
  }
  const localNames = new Set(local.map((asset) => asset.name))
  for (const asset of remote) {
    if (!localNames.has(asset.name)) problems.push(`${asset.name} is on the release but was not built`)
  }
  return problems
}

export async function verifyRelease(input: {
  readonly local: readonly LocalReleaseAsset[]
  readonly release: RemoteRelease | null
  readonly expectDraft: boolean
  readonly downloadSha256: (asset: RemoteReleaseAsset) => Promise<string>
}) {
  const { release } = input
  if (release === null) return ['the release does not exist']
  const problems: string[] = []
  if (release.draft !== input.expectDraft) {
    problems.push(`the release is ${release.draft ? 'a draft' : 'published'}, expected ${input.expectDraft ? 'a draft' : 'published'}`)
  }
  problems.push(...compareReleaseAssets(input.local, release.assets))
  for (const asset of input.local.filter((candidate) => isByteVerified(candidate.name))) {
    const uploaded = release.assets.find((candidate) => candidate.name === asset.name)
    if (uploaded === undefined || uploaded.state !== UPLOADED_STATE) continue
    if ((await input.downloadSha256(uploaded)) !== asset.sha256) {
      problems.push(`${asset.name} on the release does not match the local file`)
    }
  }
  return problems
}

function sha256(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function readLocalAssets(directory: string) {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const assets: LocalReleaseAsset[] = []
  for (const entry of entries.filter((candidate) => candidate.isFile())) {
    const bytes = await fs.readFile(path.join(directory, entry.name))
    assets.push({ name: entry.name, size: bytes.length, sha256: sha256(bytes) })
  }
  if (assets.length === 0) throw new Error(`${directory} holds no release assets.`)
  return assets.sort((left, right) => left.name.localeCompare(right.name))
}

function gh(args: readonly string[]) {
  return new Promise<Buffer>((resolve, reject) => {
    execFile('gh', [...args], { encoding: 'buffer', maxBuffer: GH_MAX_BUFFER_BYTES }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}

function isRecord(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseAsset(value: unknown): RemoteReleaseAsset {
  if (
    isRecord(value) &&
    typeof value.id === 'number' &&
    typeof value.name === 'string' &&
    typeof value.size === 'number' &&
    typeof value.state === 'string'
  ) {
    return { id: value.id, name: value.name, size: value.size, state: value.state }
  }
  throw new Error('GitHub returned a release asset in an unexpected shape.')
}

/** Lists every release, drafts included, because the tag lookup endpoint does not return drafts. */
async function findRelease(repository: string, tag: string): Promise<RemoteRelease | null> {
  const pages: unknown = JSON.parse(
    (await gh(['api', '--paginate', '--slurp', `repos/${repository}/releases?per_page=100`])).toString('utf8'),
  )
  if (!Array.isArray(pages)) throw new Error('GitHub returned releases in an unexpected shape.')
  const releases: readonly unknown[] = pages.flat()
  const matches = releases.filter((release) => isRecord(release) && release.tag_name === tag)
  if (matches.length > 1) throw new Error(`More than one release uses ${tag}.`)
  const release: unknown = matches[0]
  if (release === undefined) return null
  if (!isRecord(release) || typeof release.draft !== 'boolean' || !Array.isArray(release.assets)) {
    throw new Error('GitHub returned a release in an unexpected shape.')
  }
  return { draft: release.draft, assets: release.assets.map(parseAsset) }
}

function argumentValue(args: readonly string[], flag: string) {
  const value = args[args.indexOf(flag) + ARGUMENT_VALUE_OFFSET]
  if (!args.includes(flag) || value === undefined || value.startsWith('--')) {
    throw new Error('Usage: verify-release-assets.ts --repo <owner/repo> --tag <tag> --dir <directory> [--published]')
  }
  return value
}

async function main() {
  const args = process.argv.slice(FIRST_CLI_ARGUMENT)
  const repository = argumentValue(args, '--repo')
  const tag = argumentValue(args, '--tag')
  const expectDraft = !args.includes('--published')
  const local = await readLocalAssets(argumentValue(args, '--dir'))
  const problems = await verifyRelease({
    local,
    release: await findRelease(repository, tag),
    expectDraft,
    downloadSha256: async (asset) =>
      sha256(await gh(['api', '-H', 'Accept: application/octet-stream', `repos/${repository}/releases/assets/${asset.id}`])),
  })
  if (problems.length > 0) {
    throw new Error(`Release ${tag} does not match the built assets:\n${problems.map((problem) => `- ${problem}`).join('\n')}`)
  }
  console.log(`Release ${tag} (${expectDraft ? 'draft' : 'published'}) holds exactly the ${local.length} built assets.`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
