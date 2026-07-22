import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  verifyReleaseArtifactBundle,
} from './package-release-artifact-contract'
import type {
  PackageReleaseArtifact,
  PackageReleaseArtifactManifest,
} from './package-release-artifact-contract'
import { decodePackageReleasePlan } from './package-release-plan'
import type { PackageReleasePlan, PackageReleasePlanItem } from './package-release-plan'

export type {
  PackageReleaseArtifact,
  PackageReleaseArtifactManifest,
} from './package-release-artifact-contract'
export { verifyReleaseArtifactBundle } from './package-release-artifact-contract'

const CLI_ARGUMENT_START_INDEX = 2
const EXPECTED_CLI_ARGUMENT_COUNT = 3
const JSON_INDENT_SPACES = 2

function run(command: string, args: readonly string[], cwd?: string) {
  return new Promise<string>((resolve, reject) => {
    execFile(command, args, { cwd, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error !== null) {
        reject(new Error(stderr.trim() || error.message))
        return
      }
      resolve(stdout.trim())
    })
  })
}

function isJsonObject(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

export async function readPackageReleasePlan(planPath: string) {
  return decodePackageReleasePlan(await readJson(planPath))
}

function packedFilename(value: unknown) {
  const candidate: unknown = Array.isArray(value) ? value[0] : value
  if (!isJsonObject(candidate) || typeof candidate.filename !== 'string') {
    throw new Error('pnpm pack did not return one artifact filename.')
  }
  return candidate.filename
}

function packedDependency(
  plannedPackage: PackageReleasePlanItem,
  packedManifest: { readonly [key: string]: unknown },
) {
  if (plannedPackage.dependency === undefined) return undefined
  const dependencyRange = isJsonObject(packedManifest.dependencies)
    ? packedManifest.dependencies[plannedPackage.dependency]
    : undefined
  if (
    typeof dependencyRange !== 'string' ||
    !/^\^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(dependencyRange)
  ) {
    throw new Error(`${plannedPackage.name} must pack an exact caret dependency range.`)
  }
  return { name: plannedPackage.dependency, version: dependencyRange.slice(1) }
}

async function packageReleaseNotes(plannedPackage: PackageReleasePlanItem) {
  const changelog = await readFile(
    path.join(plannedPackage.packagePath, 'CHANGELOG.md'),
    'utf8',
  )
  const heading = `## ${plannedPackage.version}`
  const releaseStart = changelog.indexOf(heading)
  if (releaseStart < 0) {
    throw new Error(
      `${plannedPackage.name} changelog has no ${plannedPackage.version} release notes.`,
    )
  }
  const nextHeading = changelog.indexOf('\n## ', releaseStart + heading.length)
  return changelog.slice(releaseStart, nextHeading < 0 ? undefined : nextHeading).trim()
}

async function packPlannedPackage(
  plannedPackage: PackageReleasePlanItem,
  artifactRoot: string,
): Promise<PackageReleaseArtifact> {
  const packOutput = await run('pnpm', [
    '--dir',
    plannedPackage.packagePath,
    'pack',
    '--pack-destination',
    artifactRoot,
    '--json',
  ])
  const rawPackOutput: unknown = JSON.parse(packOutput)
  const reportedPath = packedFilename(rawPackOutput)
  const resolvedPath = await realpath(
    path.isAbsolute(reportedPath)
      ? reportedPath
      : path.join(plannedPackage.packagePath, reportedPath),
  )
  if (path.dirname(resolvedPath) !== (await realpath(artifactRoot))) {
    throw new Error(`${plannedPackage.name} pack output escaped the artifact directory.`)
  }
  const packedManifest: unknown = JSON.parse(
    await run('tar', ['-xOf', resolvedPath, 'package/package.json']),
  )
  if (!isJsonObject(packedManifest)) {
    throw new Error(`${plannedPackage.name} packed manifest is invalid.`)
  }
  const dependency = packedDependency(plannedPackage, packedManifest)
  const contents = await readFile(resolvedPath)
  return {
    ...(dependency === undefined ? {} : { dependency }),
    file: path.basename(resolvedPath),
    integrity: `sha512-${createHash('sha512').update(contents).digest('base64')}`,
    key: plannedPackage.key,
    name: plannedPackage.name,
    releaseNotes: await packageReleaseNotes(plannedPackage),
    sha256: createHash('sha256').update(contents).digest('hex'),
    tag: plannedPackage.tag,
    version: plannedPackage.version,
  }
}

export async function prepareReleaseArtifactBundle(
  plan: PackageReleasePlan,
  artifactRoot: string,
) {
  await mkdir(artifactRoot, { recursive: true })
  if ((await readdir(artifactRoot)).length > 0) {
    throw new Error('Package release artifact directory must start empty.')
  }
  const packages: PackageReleaseArtifact[] = []
  for (const plannedPackage of plan.packages) {
    packages.push(await packPlannedPackage(plannedPackage, artifactRoot))
  }
  const manifest: PackageReleaseArtifactManifest = {
    packages,
    schemaVersion: 1,
    sourceSha: plan.sourceSha,
    sourceTree: plan.sourceTree,
  }
  await writeFile(
    path.join(artifactRoot, 'release-artifacts.json'),
    `${JSON.stringify(manifest, null, JSON_INDENT_SPACES)}\n`,
  )
  await verifyReleaseArtifactBundle(plan, artifactRoot)
  return manifest
}

export async function runPackageReleaseArtifactsCli(args: readonly string[]) {
  if (args.length !== EXPECTED_CLI_ARGUMENT_COUNT) {
    throw new Error(
      'Usage: package-release-artifacts.ts <prepare|verify> <plan-json> <artifact-root>.',
    )
  }
  const [mode, planPath, artifactRoot] = args
  if (planPath === undefined || artifactRoot === undefined) {
    throw new Error('Package release artifact arguments are incomplete.')
  }
  const plan = await readPackageReleasePlan(planPath)
  if (mode === 'prepare') return prepareReleaseArtifactBundle(plan, artifactRoot)
  if (mode === 'verify') return verifyReleaseArtifactBundle(plan, artifactRoot)
  throw new Error(`Unsupported package release artifact mode: ${String(mode)}.`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runPackageReleaseArtifactsCli(process.argv.slice(CLI_ARGUMENT_START_INDEX)).catch(
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    },
  )
}
