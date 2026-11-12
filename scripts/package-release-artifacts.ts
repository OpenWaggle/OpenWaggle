import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type {
  PackageReleaseArtifact,
  PackageReleaseArtifactManifest,
} from './package-release-artifact-contract'
import { verifyReleaseArtifactBundle } from './package-release-artifact-contract'
import type { PackageReleasePlan, PackageReleasePlanItem } from './package-release-plan'
import { decodePackageReleasePlan } from './package-release-plan'
import { bunExecutable } from './support/node-runtime'

export type {
  PackageReleaseArtifact,
  PackageReleaseArtifactManifest,
} from './package-release-artifact-contract'
import { Schema } from '@shared/schema'
import { objectFields, unknownField } from './support/object-fields'
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

function isJsonObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJson(filePath: string) {
  const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'))
  return parsed
}

export async function readPackageReleasePlan(planPath: string) {
  return decodePackageReleasePlan(await readJson(planPath))
}

/** `bun pm pack --quiet` prints only the tarball path. */
export function packedFilename(output: string) {
  const lines = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const [filename] = lines
  if (lines.length !== 1 || filename === undefined || !filename.endsWith('.tgz')) {
    throw new Error('bun pm pack did not report one artifact filename.')
  }
  return filename
}

const packedDependenciesSchema = Schema.Struct({ dependencies: unknownField })

function packedDependency(
  plannedPackage: PackageReleasePlanItem,
  packedManifest: Readonly<Record<string, unknown>>,
) {
  if (plannedPackage.dependency === undefined) return undefined
  const dependencies = objectFields(packedDependenciesSchema, packedManifest)?.dependencies
  // The packed dependencies, by name: a map read with the planned dependency's name.
  const dependencyRange = isJsonObject(dependencies)
    ? dependencies[plannedPackage.dependency]
    : undefined
  if (
    typeof dependencyRange !== 'string' ||
    !/^\^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(dependencyRange)
  ) {
    throw new Error(`${plannedPackage.name} must pack an exact caret dependency range.`)
  }
  return { name: plannedPackage.dependency, version: dependencyRange.slice(1) }
}

function releaseHeadingVersion(line: string) {
  const plainHeading =
    /^## (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?: \([^)]+\))?$/u.exec(line)
  if (plainHeading?.[1] !== undefined) return plainHeading[1]

  const linkedHeading =
    /^## \[(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\]\([^)]+\)(?: \([^)]+\))?$/u.exec(
      line,
    )
  return linkedHeading?.[1]
}

export function extractPackageReleaseNotes(changelog: string, version: string) {
  const lines = changelog.replaceAll('\r\n', '\n').split('\n')
  const releaseLine = lines.findIndex((line) => releaseHeadingVersion(line) === version)
  if (releaseLine < 0) return undefined

  const nextReleaseOffset = lines
    .slice(releaseLine + 1)
    .findIndex((line) => releaseHeadingVersion(line) !== undefined)
  const releaseEnd = nextReleaseOffset < 0 ? lines.length : releaseLine + 1 + nextReleaseOffset
  return lines.slice(releaseLine, releaseEnd).join('\n').trim()
}

async function packageReleaseNotes(plannedPackage: PackageReleasePlanItem) {
  const changelog = await readFile(path.join(plannedPackage.packagePath, 'CHANGELOG.md'), 'utf8')
  const releaseNotes = extractPackageReleaseNotes(changelog, plannedPackage.version)
  if (releaseNotes === undefined) {
    throw new Error(
      `${plannedPackage.name} changelog has no ${plannedPackage.version} release notes.`,
    )
  }
  return releaseNotes
}

async function packPlannedPackage(plannedPackage: PackageReleasePlanItem, artifactRoot: string) {
  // Like `pnpm pack` before it, `bun pm pack` rewrites `workspace:` and `catalog:` ranges to the
  // versions they resolve to, so the tarball's manifest is what npm consumers install.
  const packOutput = await run(
    bunExecutable(),
    ['pm', 'pack', '--destination', path.resolve(artifactRoot), '--quiet'],
    plannedPackage.packagePath,
  )
  const reportedPath = packedFilename(packOutput)
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

export async function prepareReleaseArtifactBundle(plan: PackageReleasePlan, artifactRoot: string) {
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
