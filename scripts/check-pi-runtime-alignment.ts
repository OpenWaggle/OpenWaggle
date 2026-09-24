import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
const PI_CATALOG = 'pi-runtime'
const PI_PACKAGES = [
  'pi-agent-core',
  'pi-ai',
  'pi-client',
  'pi-coding-agent',
  'pi-protocol',
  'pi-telemetry',
  'pi-tui',
] as const
const PATCHED_PI_PACKAGES = ['pi-ai', 'pi-coding-agent'] as const
const BEFORE_PATCH_PATH_CAPTURE = 1
const AFTER_PATCH_PATH_CAPTURE = 2
const EXPECTED_PATCH_PATHS = {
  'pi-ai': [
    'dist/api/openai-responses-shared.js',
    'dist/api/openai-responses.d.ts',
    'dist/api/openai-responses.js',
    'dist/providers/openai-codex.models.js',
    'dist/providers/openai.models.js',
    'dist/types.d.ts',
    'dist/utils/provider-retry.d.ts',
    'dist/utils/provider-retry.js',
    'dist/utils/retry.d.ts',
    'dist/utils/retry.js',
  ],
  'pi-coding-agent': [
    'dist/core/agent-session.d.ts',
    'dist/core/agent-session.js',
    'dist/core/compaction/compaction.d.ts',
    'dist/core/compaction/compaction.js',
    'dist/core/messages.d.ts',
    'dist/core/messages.js',
    'dist/core/model-runtime.d.ts',
    'dist/core/model-runtime.js',
    'dist/core/sdk.js',
    'dist/core/session-manager.d.ts',
    'dist/core/session-manager.js',
    'dist/core/settings-manager.d.ts',
    'dist/core/settings-manager.js',
    'dist/index.d.ts',
    'dist/index.js',
  ],
} as const

export interface PiRuntimeAlignmentInput {
  readonly lockfile: string
  readonly patchContents: Readonly<Record<string, string>>
  readonly patchFiles: readonly string[]
  readonly piWaggleDevDependencies: Readonly<Record<string, string>>
  readonly rootDependencies: Readonly<Record<string, string>>
  readonly workspace: string
}

function packageRef(packageName: string) {
  return `@earendil-works/${packageName}`
}

const dependencyMapSchema = z.record(z.string(), z.string())
const packageManifestSchema = z.object({
  dependencies: dependencyMapSchema.optional(),
  devDependencies: dependencyMapSchema.optional(),
})

function manifestDependencies(manifestText: string, field: 'dependencies' | 'devDependencies') {
  const manifest: unknown = JSON.parse(manifestText)
  const dependencies = packageManifestSchema.parse(manifest)[field]
  if (!dependencies) throw new Error(`Package manifest is missing ${field}.`)
  return dependencies
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function catalogVersion(workspace: string, packageName: string) {
  const match = workspace.match(
    new RegExp(`^    ["']?${escapeRegex(packageRef(packageName))}["']?: ([^\\s#]+)$`, 'm'),
  )
  return match?.[1]
}

function versionsFor(lockfile: string, packageName: string) {
  return new Set(
    [...lockfile.matchAll(new RegExp(`${escapeRegex(packageRef(packageName))}@(\\d+\\.\\d+\\.\\d+)`, 'g'))].map(
      (match) => match[1],
    ),
  )
}

function directPinProblems(input: PiRuntimeAlignmentInput) {
  const problems: string[] = []
  const catalogSpecifier = `catalog:${PI_CATALOG}`
  for (const packageName of ['pi-ai', 'pi-coding-agent'] as const) {
    if (input.rootDependencies[packageRef(packageName)] !== catalogSpecifier) {
      problems.push(`package.json must pin ${packageRef(packageName)} through ${catalogSpecifier}.`)
    }
  }
  for (const packageName of ['pi-coding-agent', 'pi-tui'] as const) {
    if (input.piWaggleDevDependencies[packageRef(packageName)] !== catalogSpecifier) {
      problems.push(
        `packages/pi-waggle/package.json must pin ${packageRef(packageName)} through ${catalogSpecifier}.`,
      )
    }
  }
  return problems
}

function changedPatchPaths(patch: string) {
  const paths: string[] = []
  for (const match of patch.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)) {
    const before = match[BEFORE_PATCH_PATH_CAPTURE]
    const after = match[AFTER_PATCH_PATH_CAPTURE]
    paths.push(before === after ? before : `${before} -> ${after}`)
  }
  return paths
}

function patchProblems(input: PiRuntimeAlignmentInput, version: string) {
  const problems: string[] = []
  const expectedPatchFiles = PATCHED_PI_PACKAGES.map(
    (packageName) => `@earendil-works__${packageName}@${version}.patch`,
  )
  const actualPatchFiles = input.patchFiles.filter((file) => file.startsWith('@earendil-works__pi-'))
  if (
    actualPatchFiles.length !== expectedPatchFiles.length ||
    expectedPatchFiles.some((file) => !actualPatchFiles.includes(file))
  ) {
    problems.push(`patches/ must contain only the ${version} pi-ai and pi-coding-agent patches.`)
  }
  for (const packageName of PATCHED_PI_PACKAGES) {
    const patchFile = `@earendil-works__${packageName}@${version}.patch`
    const patch = input.patchContents[patchFile] ?? ''
    const allowedPaths: readonly string[] = EXPECTED_PATCH_PATHS[packageName]
    const changedPaths = changedPatchPaths(patch)
    if (changedPaths.length === 0 || changedPaths.some((changedPath) => !allowedPaths.includes(changedPath))) {
      problems.push(`${patchFile} may only change the expected dist files.`)
    }
    if (/^\+(?!\+\+\+).*(?:<<<<<<<|=======|>>>>>>>)/m.test(patch)) {
      problems.push(`${patchFile} contains added conflict markers.`)
    }
    const registration = `  '${packageRef(packageName)}@${version}': patches/@earendil-works__${packageName}@${version}.patch`
    if (!input.workspace.includes(registration)) {
      problems.push(`pnpm-workspace.yaml must register the ${version} ${packageName} patch.`)
    }
    if (
      !new RegExp(
        `^ {2}'${escapeRegex(packageRef(packageName))}@${escapeRegex(version)}': [a-f0-9]+$`,
        'm',
      ).test(input.lockfile)
    ) {
      problems.push(`pnpm-lock.yaml must register the ${version} ${packageName} patch hash.`)
    }
  }
  return problems
}

export function collectPiRuntimeAlignmentProblems(input: PiRuntimeAlignmentInput) {
  const problems: string[] = []
  const version = catalogVersion(input.workspace, 'pi-ai')
  if (!version) return ['pnpm-workspace.yaml is missing the pi-runtime catalog version.']

  for (const packageName of PI_PACKAGES) {
    if (catalogVersion(input.workspace, packageName) !== version) {
      problems.push(`${packageRef(packageName)} must use ${version} in catalogs.${PI_CATALOG}.`)
    }
  }

  problems.push(...directPinProblems(input))

  const ageEntries = [...input.workspace.matchAll(/^ {2}- ["']?(@earendil-works\/pi-[^"'\s]+@[^"'\s]+)["']?$/gm)].map(
    (match) => match[1],
  )
  const expectedAgeEntries = PI_PACKAGES.map((packageName) => `${packageRef(packageName)}@${version}`)
  if (
    ageEntries.length > 0 &&
    (ageEntries.length !== expectedAgeEntries.length ||
      expectedAgeEntries.some((entry) => !ageEntries.includes(entry)))
  ) {
    problems.push(`minimumReleaseAgeExclude must be empty or contain the seven matched Pi packages at ${version}.`)
  }

  for (const packageName of PI_PACKAGES) {
    const versions = versionsFor(input.lockfile, packageName)
    if (versions.size > 0 && (versions.size !== 1 || !versions.has(version))) {
      problems.push(`${packageRef(packageName)} lockfile versions must align at ${version}.`)
    }
  }

  problems.push(...patchProblems(input, version))
  return problems
}

async function main() {
  const root = process.cwd()
  const [workspace, lockfile, patchFiles, rootPackageText, piWagglePackageText] = await Promise.all([
    readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8'),
    readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8'),
    readdir(path.join(root, 'patches')),
    readFile(path.join(root, 'package.json'), 'utf8'),
    readFile(path.join(root, 'packages/pi-waggle/package.json'), 'utf8'),
  ])
  const patchContents: Record<string, string> = {}
  await Promise.all(
    patchFiles.map(async (file) => {
      patchContents[file] = await readFile(path.join(root, 'patches', file), 'utf8')
    }),
  )
  const problems = collectPiRuntimeAlignmentProblems({
    lockfile,
    patchContents,
    patchFiles,
    piWaggleDevDependencies: manifestDependencies(piWagglePackageText, 'devDependencies'),
    rootDependencies: manifestDependencies(rootPackageText, 'dependencies'),
    workspace,
  })
  if (problems.length > 0) throw new Error(problems.join('\n'))
  console.log(`Pi runtime packages, direct pins, age exclusions, and patches align at ${catalogVersion(workspace, 'pi-ai')}.`)
}

if (process.argv[1]?.endsWith('check-pi-runtime-alignment.ts')) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
