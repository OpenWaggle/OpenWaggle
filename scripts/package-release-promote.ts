import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const CLI_ARGUMENT_START_INDEX = 2
const EXPECTED_CLI_ARGUMENT_COUNT = 2

interface PackageReleasePlan {
  readonly sourceSha: string
}

interface PackageReleaseArtifact {
  readonly file: string
  readonly key: string
  readonly name: string
  readonly releaseNotes: string
  readonly tag: string
  readonly version: string
}

interface PackageReleaseArtifactManifest {
  readonly packages: readonly PackageReleaseArtifact[]
  readonly sourceSha: string
}

interface PromotionDependencies {
  readonly ensureGitHubRelease: typeof ensureGitHubRelease
  readonly ensureTag: typeof ensureTag
  readonly publish: (artifact: PackageReleaseArtifact, tarballPath: string) => Promise<void>
  readonly readRegistryIntegrity: typeof readRegistryIntegrity
  readonly sleep: typeof sleep
}

interface PromotionModule {
  readonly promoteVerifiedPackageRelease: (
    plan: PackageReleasePlan,
    manifest: PackageReleaseArtifactManifest,
    artifactRoot: string,
    dependencies: PromotionDependencies,
  ) => Promise<void>
  readonly readPackageReleasePlan: (planPath: string) => Promise<PackageReleasePlan>
  readonly verifyPromotionBundle: (
    plan: PackageReleasePlan,
    artifactRoot: string,
  ) => Promise<PackageReleaseArtifactManifest>
}

interface CommandResult {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

function run(command: string, args: readonly string[], allowFailure = false) {
  return new Promise<CommandResult>((resolve, reject) => {
    execFile(command, args, { encoding: 'utf8' }, (error, stdout, stderr) => {
      const exitCode = error === null ? 0 : typeof error.code === 'number' ? error.code : 1
      if (error !== null && !allowFailure) {
        reject(new Error(stderr.trim() || stdout.trim() || error.message))
        return
      }
      resolve({ exitCode, stderr, stdout })
    })
  })
}

function isJsonObject(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function releaseAssetRepairPlan(
  value: unknown,
  tag: string,
  expectedNames: readonly string[],
) {
  if (
    !isJsonObject(value) ||
    value.tagName !== tag ||
    !Array.isArray(value.assets)
  ) {
    throw new Error(`GitHub Release ${tag} does not match its immutable tag and assets.`)
  }
  const assetNames = value.assets.map((asset) => {
    if (!isJsonObject(asset) || typeof asset.name !== 'string') {
      throw new Error(`GitHub Release ${tag} returned an invalid asset.`)
    }
    return asset.name
  })
  const uniqueNames = new Set(assetNames)
  if (
    uniqueNames.size !== assetNames.length ||
    assetNames.some((name) => !expectedNames.includes(name))
  ) {
    throw new Error(`GitHub Release ${tag} contains unexpected or duplicate assets.`)
  }
  return {
    missingNames: expectedNames.filter((name) => !uniqueNames.has(name)),
    presentNames: expectedNames.filter((name) => uniqueNames.has(name)),
  }
}

function isPromotionModule(value: unknown): value is PromotionModule {
  return isJsonObject(value) &&
    typeof value.promoteVerifiedPackageRelease === 'function' &&
    typeof value.readPackageReleasePlan === 'function' &&
    typeof value.verifyPromotionBundle === 'function'
}

async function loadPromotionModule() {
  const moduleUrl = new URL('./package-release-promotion.ts', import.meta.url).href
  const loaded: unknown = await import(moduleUrl)
  if (!isPromotionModule(loaded)) throw new Error('Package release promotion module is invalid.')
  return loaded
}

async function readRegistryIntegrity(name: string, version: string) {
  const result = await run('npm', [
    'view', `${name}@${version}`, 'dist.integrity', '--json',
    '--registry', 'https://registry.npmjs.org/',
  ], true)
  if (result.exitCode !== 0) {
    if (/E404|404 Not Found/.test(result.stderr)) return null
    throw new Error(result.stderr.trim() || `Unable to inspect ${name}@${version} on npm.`)
  }
  const integrity: unknown = JSON.parse(result.stdout)
  if (typeof integrity !== 'string') {
    throw new Error(`npm returned invalid integrity for ${name}@${version}.`)
  }
  return integrity
}

async function ensureTag(tag: string, sourceSha: string) {
  const repository = process.env.GITHUB_REPOSITORY
  if (repository === undefined) throw new Error('GITHUB_REPOSITORY is required.')
  const existing = await run('gh', ['api', `repos/${repository}/git/ref/tags/${tag}`], true)
  if (existing.exitCode === 0) {
    const response: unknown = JSON.parse(existing.stdout)
    if (!isJsonObject(response) || !isJsonObject(response.object) || response.object.sha !== sourceSha) {
      throw new Error(`Immutable package tag ${tag} points to a different commit.`)
    }
    return
  }
  if (!/HTTP 404|Not Found/.test(existing.stderr)) {
    throw new Error(existing.stderr.trim() || `Unable to inspect package tag ${tag}.`)
  }
  await run('gh', [
    'api', '--method', 'POST', `repos/${repository}/git/refs`,
    '-f', `ref=refs/tags/${tag}`, '-f', `sha=${sourceSha}`,
  ])
}

async function ensureGitHubRelease({ artifact, artifactRoot }: Readonly<{
  artifact: PackageReleaseArtifact
  artifactRoot: string
  sourceSha: string
}>) {
  const expectedPaths = [
    path.join(artifactRoot, artifact.file),
    path.join(artifactRoot, 'release-artifacts.json'),
  ]
  const expectedNames = expectedPaths.map((filePath) => path.basename(filePath))
  const existing = await run(
    'gh',
    ['release', 'view', artifact.tag, '--json', 'tagName,assets'],
    true,
  )
  if (existing.exitCode === 0) {
    const response: unknown = JSON.parse(existing.stdout)
    const repairPlan = releaseAssetRepairPlan(response, artifact.tag, expectedNames)
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'openwaggle-release-assets-'))
    try {
      for (const assetName of repairPlan.presentNames) {
        await run('gh', [
          'release', 'download', artifact.tag,
          '--pattern', assetName, '--dir', temporaryDirectory,
        ])
        const [expected, downloaded] = await Promise.all([
          readFile(path.join(artifactRoot, assetName)),
          readFile(path.join(temporaryDirectory, assetName)),
        ])
        if (
          createHash('sha256').update(expected).digest('hex') !==
          createHash('sha256').update(downloaded).digest('hex')
        ) {
          throw new Error(`GitHub Release ${artifact.tag} asset ${assetName} has different bytes.`)
        }
      }
      const missingPaths = expectedPaths.filter((filePath) =>
        repairPlan.missingNames.includes(path.basename(filePath)),
      )
      if (missingPaths.length > 0) {
        await run('gh', ['release', 'upload', artifact.tag, ...missingPaths])
      }
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true })
    }
    return
  }
  if (!/HTTP 404|release not found|not found/i.test(existing.stderr)) {
    throw new Error(existing.stderr.trim() || `Unable to inspect GitHub Release ${artifact.tag}.`)
  }
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'openwaggle-release-notes-'))
  try {
    const notesPath = path.join(temporaryDirectory, `${artifact.key}.md`)
    await writeFile(notesPath, `${artifact.releaseNotes}\n`)
    await run('gh', [
      'release', 'create', artifact.tag,
      ...expectedPaths,
      '--verify-tag', '--title', `${artifact.name} ${artifact.version}`, '--notes-file', notesPath,
    ])
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
}

function sleep(durationMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, durationMs))
}

function verifyPublicationEnvironment(plan: PackageReleasePlan) {
  if (process.env.GITHUB_EVENT_NAME !== 'push' || process.env.GITHUB_REF !== 'refs/heads/main') {
    throw new Error('Package publication is allowed only for a main branch push.')
  }
  if (process.env.GITHUB_SHA !== plan.sourceSha) {
    throw new Error('Package release plan does not match the triggering main commit.')
  }
  if (process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN === undefined ||
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL === undefined) {
    throw new Error('GitHub OIDC token request environment is unavailable.')
  }
}

async function verifyArtifactProvenance(
  artifactRoot: string,
  manifest: PackageReleaseArtifactManifest,
) {
  const repository = process.env.GITHUB_REPOSITORY
  if (repository === undefined) throw new Error('GITHUB_REPOSITORY is required.')
  for (const file of [
    path.join(artifactRoot, 'release-artifacts.json'),
    ...manifest.packages.map(({ file }) => path.join(artifactRoot, file)),
  ]) {
    await run('gh', ['attestation', 'verify', file, '--repo', repository])
  }
}

export async function runPackageReleasePromoteCli(args: readonly string[]) {
  if (args.length !== EXPECTED_CLI_ARGUMENT_COUNT) {
    throw new Error('Usage: package-release-promote.ts <plan-json> <artifact-root>.')
  }
  const [planPath, artifactRoot] = args
  if (planPath === undefined || artifactRoot === undefined) {
    throw new Error('Package release promotion arguments are incomplete.')
  }
  const promotion = await loadPromotionModule()
  const plan = await promotion.readPackageReleasePlan(planPath)
  verifyPublicationEnvironment(plan)
  const manifest = await promotion.verifyPromotionBundle(plan, artifactRoot)
  if (manifest.sourceSha !== process.env.EXPECTED_ARTIFACT_SOURCE_SHA) {
    throw new Error('Package artifact source SHA does not match its successful CI run.')
  }
  await verifyArtifactProvenance(artifactRoot, manifest)
  await promotion.promoteVerifiedPackageRelease(plan, manifest, artifactRoot, {
    ensureGitHubRelease,
    ensureTag,
    publish: async (_artifact, tarballPath) => {
      await run('node', [
        '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
        path.join('scripts', 'package-release-publish.ts'),
        tarballPath,
      ])
    },
    readRegistryIntegrity,
    sleep,
  })
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runPackageReleasePromoteCli(process.argv.slice(CLI_ARGUMENT_START_INDEX)).catch(
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    },
  )
}
