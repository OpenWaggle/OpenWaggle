import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { type ParseError, parse as parseJsonc, printParseErrorCode } from 'jsonc-parser'
import { parse as parseToml } from 'smol-toml'

/**
 * Readers for the dependency configuration Bun installs from: `bun.lock`, the `workspaces`,
 * `patchedDependencies` and catalogs of the root `package.json`, and the `[install]` table of
 * `bunfig.toml`. Repository checks read these instead of re-parsing them each in their own way.
 */

export const BUN_LOCKFILE = 'bun.lock'
export const BUNFIG = 'bunfig.toml'

/** A registry package version `bun.lock` resolves. */
export interface LockedPackage {
  /** The lockfile key, such as `pkijs/@noble/hashes` for a nested copy. */
  readonly key: string
  readonly name: string
  readonly version: string
  readonly integrity: string | undefined
}

export interface BunLockfile {
  readonly packages: readonly LockedPackage[]
  readonly patchedDependencies: Readonly<Record<string, string>>
  readonly catalogs: Readonly<Record<string, Readonly<Record<string, string>>>>
}

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringRecord(value: unknown): Readonly<Record<string, string>> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

function catalogRecord(value: unknown) {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).map(([name, catalog]) => [name, stringRecord(catalog)]),
  )
}

/** Parses JSON with comments and trailing commas, the format of `bun.lock`. */
export function parseJsoncText(text: string, label: string): unknown {
  const errors: ParseError[] = []
  const value: unknown = parseJsonc(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  })
  const [first] = errors
  if (first) {
    throw new Error(
      `${label} is not valid JSON: ${printParseErrorCode(first.error)} at offset ${first.offset}.`,
    )
  }
  return value
}

/** Splits `name@version` (and `@scope/name@version`) at the version separator. */
export function splitPackageSpecifier(specifier: string) {
  const separator = specifier.indexOf('@', 1)
  if (separator <= 0) return { name: specifier, version: '' }
  return { name: specifier.slice(0, separator), version: specifier.slice(separator + 1) }
}

/**
 * The registry packages of a `bun.lock`. An entry is `[resolution, registry, metadata, integrity]`;
 * workspace, `file:`, git and tarball entries resolve to something other than an exact version and
 * are skipped.
 */
export function parseBunLockfile(text: string): BunLockfile {
  const lockfile = parseJsoncText(text, BUN_LOCKFILE)
  if (!isRecord(lockfile) || !isRecord(lockfile.packages)) {
    throw new Error(`${BUN_LOCKFILE} must contain a packages object.`)
  }
  const packages: LockedPackage[] = []
  for (const [key, entry] of Object.entries(lockfile.packages)) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string') continue
    const { name, version } = splitPackageSpecifier(entry[0])
    if (!EXACT_VERSION.test(version)) continue
    const integrity: unknown = entry[3]
    packages.push({
      key,
      name,
      version,
      integrity: typeof integrity === 'string' ? integrity : undefined,
    })
  }
  return {
    packages,
    patchedDependencies: stringRecord(lockfile.patchedDependencies),
    catalogs: catalogRecord(lockfile.catalogs),
  }
}

/** Every version of `name` the lockfile resolves. */
export function lockedVersions(lockfile: BunLockfile, name: string) {
  return new Set(
    lockfile.packages.filter((entry) => entry.name === name).map((entry) => entry.version),
  )
}

export interface RootWorkspaceConfig {
  readonly catalogs: Readonly<Record<string, Readonly<Record<string, string>>>>
  readonly patchedDependencies: Readonly<Record<string, string>>
}

/** The catalogs (`catalog` is the unnamed `default` one) and patches of the root `package.json`. */
export function parseRootWorkspaceConfig(manifestText: string): RootWorkspaceConfig {
  const manifest: unknown = JSON.parse(manifestText)
  if (!isRecord(manifest)) throw new Error('package.json must contain an object.')
  const workspaces = isRecord(manifest.workspaces) ? manifest.workspaces : {}
  const catalogs: Record<string, Readonly<Record<string, string>>> = {
    ...catalogRecord(workspaces.catalogs),
  }
  if (isRecord(workspaces.catalog)) catalogs.default = stringRecord(workspaces.catalog)
  return { catalogs, patchedDependencies: stringRecord(manifest.patchedDependencies) }
}

/** `install.minimumReleaseAgeExcludes` of `bunfig.toml`. */
export function parseMinimumReleaseAgeExcludes(bunfigText: string) {
  let config: unknown
  try {
    config = parseToml(bunfigText)
  } catch (error) {
    throw new Error(
      `${BUNFIG} is not valid TOML: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    )
  }
  const install = isRecord(config) ? config.install : undefined
  const excludes = isRecord(install) ? install.minimumReleaseAgeExcludes : undefined
  if (!Array.isArray(excludes) || !excludes.every((entry) => typeof entry === 'string')) {
    throw new Error(
      `${BUNFIG} must define install.minimumReleaseAgeExcludes as an array of strings.`,
    )
  }
  return excludes.filter((entry): entry is string => typeof entry === 'string')
}

export async function readRepositoryDependencyConfig(root: string) {
  const [lockfileText, manifestText, bunfigText] = await Promise.all([
    readFile(path.join(root, BUN_LOCKFILE), 'utf8'),
    readFile(path.join(root, 'package.json'), 'utf8'),
    readFile(path.join(root, BUNFIG), 'utf8'),
  ])
  return { lockfileText, manifestText, bunfigText }
}
