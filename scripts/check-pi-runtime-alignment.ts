import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { EXPECTED_PATCH_PATHS } from './pi-runtime-patch-paths'
import { releaseAgeExclusionProblems } from './pi-runtime-release-age'
import {
  BUN_LOCKFILE,
  type BunLockfile,
  lockedVersions,
  parseBunLockfile,
  parseRootWorkspaceConfig,
  readRepositoryDependencyConfig,
  type RootWorkspaceConfig,
} from './support/bun-workspace'
const PI_CATALOG = 'pi-runtime'
const PI_PACKAGES = [
  'pi-agent-core',
  'pi-ai',
  'pi-codemode',
  'pi-coding-agent',
  'pi-mcp',
  'pi-telemetry',
  'pi-tui',
] as const
/** The matched release: since Pi 1.2.0, exactly the catalog packages. */
const PI_RELEASE_SET = PI_PACKAGES
/**
 * Packages earlier Pi releases included that Pi 1.2.0 removed (`pi-client`, `pi-protocol`,
 * `pi-server`) or stopped depending on (`chord`). Nothing may pin or resolve them any more.
 */
const RETIRED_PI_PACKAGES = ['chord', 'pi-client', 'pi-protocol', 'pi-server'] as const
const PATCHED_PI_PACKAGES = ['pi-ai', 'pi-coding-agent'] as const
const ROOT_PINNED_PI_PACKAGES = ['pi-ai', 'pi-coding-agent', 'pi-mcp'] as const
const BEFORE_PATCH_PATH_CAPTURE = 1
const AFTER_PATCH_PATH_CAPTURE = 2

export interface PiRuntimeAlignmentInput {
  /** `bunfig.toml`, for the temporary Pi release-age exclusions and their expiry marker. */
  readonly bunfig: string
  /** The catalogs of the root `package.json`. */
  readonly catalogs: RootWorkspaceConfig['catalogs']
  readonly lockfile: BunLockfile
  /** The current time, to retire temporary release-age exclusions. */
  readonly now: Date
  readonly patchContents: Readonly<Record<string, string>>
  readonly patchFiles: readonly string[]
  /** The installed pi-coding-agent's runtime dependencies: what Pi supplies to extensions. */
  readonly piCodingAgentDependencies: Readonly<Record<string, string>>
  /** `patchedDependencies` of the root `package.json`. */
  readonly patchedDependencies: Readonly<Record<string, string>>
  readonly piWaggleDevDependencies: Readonly<Record<string, string>>
  readonly rootDependencies: Readonly<Record<string, string>>
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

function catalogVersion(input: Pick<PiRuntimeAlignmentInput, 'catalogs'>, packageName: string) {
  return input.catalogs[PI_CATALOG]?.[packageRef(packageName)]
}

function versionsFor(lockfile: BunLockfile, packageName: string) {
  return lockedVersions(lockfile, packageRef(packageName))
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

/**
 * Packages Pi supplies to extensions that are not part of its own release. The
 * `pi-extension-host` catalog pins each at the version Pi depends on, so the app and pi-waggle
 * build and test against the copy Pi gives them at runtime.
 */
const PI_EXTENSION_HOST_CATALOG = 'pi-extension-host'
const PI_EXTENSION_HOST_PACKAGES = ['typebox'] as const

function extensionHostCatalogVersion(input: PiRuntimeAlignmentInput, packageName: string) {
  return input.catalogs[PI_EXTENSION_HOST_CATALOG]?.[packageName]
}

function extensionHostPackageProblems(input: PiRuntimeAlignmentInput) {
  const problems: string[] = []
  const catalogReference = `catalog:${PI_EXTENSION_HOST_CATALOG}`
  for (const name of PI_EXTENSION_HOST_PACKAGES) {
    if (input.rootDependencies[name] !== catalogReference) {
      problems.push(`package.json must take ${name} from ${catalogReference}.`)
    }
    if (input.piWaggleDevDependencies[name] !== catalogReference) {
      problems.push(`packages/pi-waggle/package.json must take ${name} from ${catalogReference}.`)
    }
    const piVersion = input.piCodingAgentDependencies[name]
    if (!piVersion) {
      problems.push(
        `pi-coding-agent no longer depends on ${name}; update catalogs.${PI_EXTENSION_HOST_CATALOG}.`,
      )
      continue
    }
    if (extensionHostCatalogVersion(input, name) !== piVersion) {
      problems.push(
        `catalogs.${PI_EXTENSION_HOST_CATALOG} must pin ${name} at pi-coding-agent's ${piVersion}.`,
      )
    }
  }
  return problems
}

function piWasmPackageProblems(input: PiRuntimeAlignmentInput) {
  const problems: string[] = []
  for (const { name, owner } of PI_WASM_PACKAGES) {
    const versions = lockedVersions(input.lockfile, name)
    if (versions.size !== 1) {
      problems.push(
        `${BUN_LOCKFILE} must resolve exactly one ${name} version, found ${versions.size}.`,
      )
      continue
    }
    const [version] = versions
    if (input.rootDependencies[name] !== version) {
      problems.push(`package.json must pin ${name} at ${owner}'s ${version}.`)
    }
  }
  return problems
}

function changedPatchPaths(patch: string) {
  const paths: string[] = []
  for (const match of patch.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)) {
    const before = match[BEFORE_PATCH_PATH_CAPTURE]
    const after = match[AFTER_PATCH_PATH_CAPTURE]
    if (before === undefined || after === undefined) continue
    paths.push(before === after ? before : `${before} -> ${after}`)
  }
  return paths
}

function patchProblems(input: PiRuntimeAlignmentInput, version: string) {
  const problems: string[] = []
  const expectedPatchFiles = PATCHED_PI_PACKAGES.map(
    (packageName) => `@earendil-works__${packageName}@${version}.patch`,
  )
  const actualPatchFiles = input.patchFiles.filter((file) =>
    file.startsWith('@earendil-works__pi-'),
  )
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
    if (
      changedPaths.length === 0 ||
      changedPaths.some((changedPath) => !allowedPaths.includes(changedPath))
    ) {
      problems.push(`${patchFile} may only change the expected dist files.`)
    }
    if (/^\+(?!\+\+\+).*(?:<<<<<<<|=======|>>>>>>>)/m.test(patch)) {
      problems.push(`${patchFile} contains added conflict markers.`)
    }
    const key = `${packageRef(packageName)}@${version}`
    const registration = `patches/${patchFile}`
    if (input.patchedDependencies[key] !== registration) {
      problems.push(
        `package.json patchedDependencies must register the ${version} ${packageName} patch.`,
      )
    }
    if (input.lockfile.patchedDependencies[key] !== registration) {
      problems.push(`${BUN_LOCKFILE} must register the ${version} ${packageName} patch.`)
    }
  }
  return problems
}

export function collectPiRuntimeAlignmentProblems(input: PiRuntimeAlignmentInput) {
  const problems: string[] = []
  const version = catalogVersion(input, 'pi-ai')
  if (!version) return ['package.json is missing the pi-runtime catalog version.']

  for (const packageName of PI_PACKAGES) {
    if (catalogVersion(input, packageName) !== version) {
      problems.push(`${packageRef(packageName)} must use ${version} in catalogs.${PI_CATALOG}.`)
    }
  }

  for (const packageName of RETIRED_PI_PACKAGES) {
    if (catalogVersion(input, packageName) !== undefined) {
      problems.push(
        `${packageRef(packageName)} is no longer part of the Pi release; remove it from catalogs.${PI_CATALOG}.`,
      )
    }
    if (versionsFor(input.lockfile, packageName).size > 0) {
      problems.push(
        `${BUN_LOCKFILE} still resolves ${packageRef(packageName)}, which the Pi release no longer includes.`,
      )
    }
  }

  problems.push(...directPinProblems(input))
  problems.push(...piWasmPackageProblems(input))
  problems.push(...extensionHostPackageProblems(input))

  const expectedAgeEntries = new Set(
    PI_RELEASE_SET.filter((packageName) => versionsFor(input.lockfile, packageName).size > 0).map(
      (packageName) => `${packageRef(packageName)}@${version}`,
    ),
  )
  problems.push(...releaseAgeExclusionProblems(input, version, expectedAgeEntries))

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
  const [config, patchFiles, piWagglePackageText, piCodingAgentText] = await Promise.all([
    readRepositoryDependencyConfig(root),
    readdir(path.join(root, 'patches')),
    readFile(path.join(root, 'packages/pi-waggle/package.json'), 'utf8'),
    readFile(path.join(root, 'node_modules/@earendil-works/pi-coding-agent/package.json'), 'utf8'),
  ])
  const patchContents: Record<string, string> = {}
  await Promise.all(
    patchFiles.map(async (file) => {
      patchContents[file] = await readFile(path.join(root, 'patches', file), 'utf8')
    }),
  )
  const { catalogs, patchedDependencies } = parseRootWorkspaceConfig(config.manifestText)
  const problems = collectPiRuntimeAlignmentProblems({
    bunfig: config.bunfigText,
    catalogs,
    lockfile: parseBunLockfile(config.lockfileText),
    patchedDependencies,
    now: new Date(),
    patchContents,
    patchFiles,
    piCodingAgentDependencies: manifestDependencies(piCodingAgentText, 'dependencies'),
    piWaggleDevDependencies: manifestDependencies(piWagglePackageText, 'devDependencies'),
    rootDependencies: manifestDependencies(config.manifestText, 'dependencies'),
  })
  if (problems.length > 0) throw new Error(problems.join('\n'))
  console.log(
    `Pi runtime packages, direct pins, age exclusions, and patches align at ${catalogVersion({ catalogs }, 'pi-ai')}.`,
  )
}

if (process.argv[1]?.endsWith('check-pi-runtime-alignment.ts')) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
