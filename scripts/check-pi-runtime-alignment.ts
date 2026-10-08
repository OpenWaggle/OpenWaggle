import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { EXPECTED_PATCH_PATHS } from './pi-runtime-patch-paths'
const PI_CATALOG = 'pi-runtime'
const PI_PACKAGES = [
  'pi-agent-core',
  'pi-ai',
  'pi-client',
  'pi-codemode',
  'pi-coding-agent',
  'pi-mcp',
  'pi-protocol',
  'pi-telemetry',
  'pi-tui',
] as const
/** Pi publishes `chord` with the catalog packages as one matched release; it has no catalog pin. */
const PI_RELEASE_SET = [...PI_PACKAGES, 'chord'] as const
const PATCHED_PI_PACKAGES = ['pi-ai', 'pi-coding-agent'] as const
const ROOT_PINNED_PI_PACKAGES = ['pi-ai', 'pi-coding-agent', 'pi-mcp'] as const
const BEFORE_PATCH_PATH_CAPTURE = 1
const AFTER_PATCH_PATH_CAPTURE = 2

export interface PiRuntimeAlignmentInput {
  readonly lockfile: string
  /** The current time, to retire temporary release-age exclusions. */
  readonly now: Date
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
  for (const packageName of ROOT_PINNED_PI_PACKAGES) {
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

/**
 * WASM packages OpenWaggle installs at the root for Pi's bundled main process (see
 * `scripts/vite/pi-worker-bundles.ts`): QuickJS for codemode, whose JavaScript is bundled from
 * Pi's own dependency while its wasm comes from the root, and Photon for image reads, which loads
 * its wasm beside its own entry. Each must be the exact build Pi depends on.
 */
const PI_WASM_PACKAGES = [
  { name: 'quickjs-wasi', owner: 'Pi codemode' },
  { name: '@silvia-odwyer/photon-node', owner: 'Pi coding agent' },
] as const

function piWasmPackageProblems(input: PiRuntimeAlignmentInput) {
  const problems: string[] = []
  for (const { name, owner } of PI_WASM_PACKAGES) {
    const versions = new Set(
      [
        ...input.lockfile.matchAll(
          new RegExp(`^ {2}'?${escapeRegex(name)}@(\\d+\\.\\d+\\.\\d+)'?:`, 'gm'),
        ),
      ].map((match) => match[1]),
    )
    if (versions.size !== 1) {
      problems.push(`pnpm-lock.yaml must resolve exactly one ${name} version, found ${versions.size}.`)
      continue
    }
    const [version] = versions
    if (input.rootDependencies[name] !== version) {
      problems.push(`package.json must pin ${name} at ${owner}'s ${version}.`)
    }
  }
  return problems
}

/**
 * Temporary Pi entries in `minimumReleaseAgeExclude` must name when the last-published package of
 * the excluded release passes pnpm's seven-day minimum release age, and the check fails from then
 * on, so the exceptions cannot linger after they stop being needed.
 */
const RELEASE_AGE_EXPIRY_MARKER = 'pi-runtime-release-age-exclusions-expire'

/**
 * Temporary exceptions cover exactly the matched-release packages the lockfile resolves (with
 * `chord`): one for a package nothing installs exempts nothing and only lingers.
 */
function releaseAgeExclusionProblems(input: PiRuntimeAlignmentInput, version: string) {
  const ageEntries = new Set(
    [
      ...input.workspace.matchAll(
        /^ {2}- ["']?(@earendil-works\/(?:pi-[^"'\s@]+|chord)@[^"'\s]+)["']?$/gm,
      ),
    ].map((match) => match[1]),
  )
  if (ageEntries.size === 0) {
    // The marker only dates entries; once they are gone it would claim exclusions that do not exist.
    return input.workspace.includes(`# ${RELEASE_AGE_EXPIRY_MARKER}`)
      ? [
          `The ${RELEASE_AGE_EXPIRY_MARKER} line has no Pi minimumReleaseAgeExclude entries left to date; remove it.`,
        ]
      : []
  }
  const expected = new Set(
    PI_RELEASE_SET.filter((packageName) => versionsFor(input.lockfile, packageName).size > 0).map(
      (packageName) => `${packageRef(packageName)}@${version}`,
    ),
  )
  const missing = [...expected].filter((entry) => !ageEntries.has(entry))
  const unneeded = [...ageEntries].filter((entry) => !expected.has(entry))
  const problems: string[] = []
  if (missing.length > 0 || unneeded.length > 0) {
    problems.push(
      `minimumReleaseAgeExclude must be empty or contain exactly the ${expected.size} matched Pi packages the lockfile resolves at ${version}: ${[
        ...missing.map((entry) => `missing ${entry}`),
        ...unneeded.map((entry) => `unneeded ${entry}`),
      ].join(', ')}.`,
    )
  }
  return [...problems, ...releaseAgeExclusionExpiryProblems(input, version)]
}

function releaseAgeExclusionExpiryProblems(input: PiRuntimeAlignmentInput, version: string) {
  const pattern = `^\\s*# ${RELEASE_AGE_EXPIRY_MARKER}: (\\d{4}-\\d{2}-\\d{2})(T\\d{2}:\\d{2}:\\d{2}Z)?$`
  const [, date, time] = input.workspace.match(new RegExp(pattern, 'm')) ?? []
  // A bare date is midnight UTC; a rolled-over date such as 2026-02-30 does not round-trip.
  const expiry = date && `${date}${time ?? 'T00:00:00Z'}`
  const expiryTime = expiry ? Date.parse(expiry) : Number.NaN
  if (!expiry || Number.isNaN(expiryTime) || new Date(expiryTime).toISOString().replace('.000Z', 'Z') !== expiry) {
    return [
      `Temporary Pi minimumReleaseAgeExclude entries need a "# ${RELEASE_AGE_EXPIRY_MARKER}: YYYY-MM-DD" or "YYYY-MM-DDTHH:MM:SSZ" line naming when every ${version} package is seven days old.`,
    ]
  }
  if (input.now.getTime() >= expiryTime) {
    return [
      `Remove the temporary Pi minimumReleaseAgeExclude entries and their ${RELEASE_AGE_EXPIRY_MARKER} line: Pi ${version} passed pnpm's seven-day minimum release age at ${expiry}.`,
    ]
  }
  return []
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
  problems.push(...piWasmPackageProblems(input))

  problems.push(...releaseAgeExclusionProblems(input, version))

  for (const packageName of PI_RELEASE_SET) {
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
    now: new Date(),
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
