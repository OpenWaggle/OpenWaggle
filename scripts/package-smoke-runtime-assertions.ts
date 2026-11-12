import { Schema } from '@shared/schema'
import { isObject } from './package-smoke-assertions'
import { objectFields, unknownField } from './support/object-fields'

/** The dependency sections of a packed manifest; each is a map keyed by package name. */
const dependencyManifestSchema = Schema.Struct({
  dependencies: unknownField,
  devDependencies: unknownField,
  optionalDependencies: unknownField,
  peerDependencies: unknownField,
  bundleDependencies: unknownField,
  bundledDependencies: unknownField,
  pi: unknownField,
})
type DependencyManifest = Schema.Schema.Type<typeof dependencyManifestSchema>

/** A dependency section, read by package name. */
function dependencyMap(value: unknown) {
  return isObject(value) ? value : undefined
}

const MINIMUM_PACKAGE_SMOKE_NODE_MAJOR = 22
const MINIMUM_PACKAGE_SMOKE_NODE_MINOR = 19

export function assertReactPeerDependencies(manifest: unknown) {
  const fields = objectFields(dependencyManifestSchema, manifest)
  const peerDependencies = dependencyMap(fields?.peerDependencies)
  const dependencies = dependencyMap(fields?.dependencies)

  for (const dependencyName of ['react', 'react-dom']) {
    if (peerDependencies?.[dependencyName] !== '^19.0.0') {
      throw new Error(
        `@openwaggle/extension-react must declare ${dependencyName} as a peer dependency.`,
      )
    }

    if (dependencies?.[dependencyName] !== undefined) {
      throw new Error(`@openwaggle/extension-react must not bundle ${dependencyName}.`)
    }
  }
}

export function supportsPackageSmokeNodeVersion(version: string) {
  const [majorText, minorText] = version.split('.')
  const major = Number(majorText)
  const minor = Number(minorText)

  if (!Number.isInteger(major) || !Number.isInteger(minor)) return false
  return (
    major > MINIMUM_PACKAGE_SMOKE_NODE_MAJOR ||
    (major === MINIMUM_PACKAGE_SMOKE_NODE_MAJOR && minor >= MINIMUM_PACKAGE_SMOKE_NODE_MINOR)
  )
}

export function isPackageSmokeDevDependency(dependencyName: string) {
  return (
    dependencyName === 'typescript' ||
    dependencyName === 'tsx' ||
    dependencyName === 'vite' ||
    dependencyName.startsWith('@types/')
  )
}

export function assertBrowserBundleContent(content: string) {
  if (content.trim().length === 0) {
    throw new Error('Browser package smoke must emit executable JavaScript.')
  }
}

export function assertBrowserRuntimeResult(input: {
  readonly status: string | null
  readonly consoleErrors: readonly string[]
  readonly pageErrors: readonly string[]
}) {
  const issues = [
    ...(input.status === 'passed' ? [] : [`reported ${input.status ?? 'no status'}`]),
    ...(input.consoleErrors.length === 0
      ? []
      : [`console errors: ${input.consoleErrors.join(' | ')}`]),
    ...(input.pageErrors.length === 0 ? [] : [`page errors: ${input.pageErrors.join(' | ')}`]),
  ]

  if (issues.length > 0) {
    throw new Error(`Browser package smoke failed: ${issues.join('; ')}.`)
  }
}

/** Workspace catalogs by name, as `parseRootWorkspaceConfig` reads them from package.json. */
export type WorkspaceCatalogs = Readonly<Record<string, Readonly<Record<string, string>>>>

export function resolvePackageSmokeCatalogVersion(
  specifier: string,
  dependencyName: string,
  catalogs: WorkspaceCatalogs,
) {
  if (!specifier.startsWith('catalog:')) return specifier
  const catalogName = specifier.slice('catalog:'.length) || 'default'
  const version = catalogs[catalogName]?.[dependencyName]
  if (typeof version !== 'string') {
    throw new Error(`Cannot resolve ${dependencyName} from catalog:${catalogName}.`)
  }
  return version
}

export function findPackageDependencyVersion(value: unknown, dependencyName: string) {
  const manifest = objectFields(dependencyManifestSchema, value)
  if (manifest === undefined) return undefined

  const scopes = [manifest.dependencies, manifest.devDependencies, manifest.peerDependencies]
  for (const scope of scopes) {
    if (isObject(scope) && typeof scope[dependencyName] === 'string') {
      return scope[dependencyName]
    }
  }

  return undefined
}

function workspaceProtocolPath(value: unknown, currentPath: string): readonly string[] {
  if (typeof value === 'string') {
    return value.startsWith('workspace:') ? [currentPath] : []
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => workspaceProtocolPath(item, `${currentPath}[${index}]`))
  }

  if (isObject(value)) {
    return Object.entries(value).flatMap(([key, item]) =>
      workspaceProtocolPath(item, currentPath ? `${currentPath}.${key}` : key),
    )
  }

  return []
}

export function assertNoWorkspaceProtocols(packageName: string, manifest: unknown) {
  const leakedPaths = workspaceProtocolPath(manifest, '')

  if (leakedPaths.length > 0) {
    throw new Error(
      `${packageName} packed manifest contains workspace protocol values at ${leakedPaths.join(', ')}.`,
    )
  }
}

/**
 * Every package of the Pi release OpenWaggle is built on, at that release's version: the
 * `pi-runtime` catalog, which since Pi 1.2.0 is the whole matched set. The consumer smoke
 * overrides them all, so a newer Pi release (or one still being published) cannot be mixed in
 * through a transitive range.
 */
export function piRuntimeSmokePins(catalogs: WorkspaceCatalogs): Record<string, string> {
  const catalog = catalogs['pi-runtime'] ?? {}
  return Object.fromEntries(Object.entries(catalog).sort(([a], [b]) => a.localeCompare(b)))
}

/** The consumer smoke's pnpm workspace: the Pi release pins plus the packed tarballs. */
export function smokePnpmWorkspaceConfig(
  pins: Readonly<Record<string, string>>,
  packedPackages: readonly { readonly name: string; readonly tarballPath: string }[],
) {
  const overrideLines = [
    ...Object.entries(pins).map(([name, version]) => `  "${name}": "${version}"`),
    ...packedPackages.map((packed) => `  "${packed.name}": "file:${packed.tarballPath}"`),
  ]
  return ['packages: []', '', 'overrides:', ...overrideLines, ''].join('\n')
}

/**
 * The packages Pi supplies to every extension, the same set as `HOST_PROVIDED_EXTENSION_PACKAGES`
 * in pi-coding-agent's `dist/core/resource-loader.js` (Pi's `docs/packages.md`, "Declare
 * dependencies"). A Pi package must declare them as `"*"` peers: a physical copy under
 * `dependencies` bypasses Pi's extension module mapping, and Pi warns about it on every start.
 */
const PI_HOST_PROVIDED_PACKAGES = [
  '@earendil-works/pi-agent-core',
  '@earendil-works/pi-ai',
  '@earendil-works/pi-coding-agent',
  '@earendil-works/pi-tui',
  '@mariozechner/pi-agent-core',
  '@mariozechner/pi-ai',
  '@mariozechner/pi-coding-agent',
  '@mariozechner/pi-tui',
  '@sinclair/typebox',
  'typebox',
] as const

/** Manifest sections whose packages are installed as physical copies inside the package. */
const INSTALLED_DEPENDENCY_SECTIONS = ['dependencies', 'optionalDependencies'] as const

function bundledDependencyNames(manifest: DependencyManifest) {
  for (const value of [manifest.bundleDependencies, manifest.bundledDependencies]) {
    if (Array.isArray(value)) {
      return value.filter((name): name is string => typeof name === 'string')
    }
  }
  return []
}

export function assertPiHostPackagesArePeers(packageName: string, value: unknown) {
  const manifest = objectFields(dependencyManifestSchema, value)
  if (manifest === undefined || !isObject(manifest.pi)) return
  const peerDependencies = dependencyMap(manifest.peerDependencies) ?? {}
  const bundled = bundledDependencyNames(manifest)
  const problems: string[] = []
  for (const name of PI_HOST_PROVIDED_PACKAGES) {
    for (const section of INSTALLED_DEPENDENCY_SECTIONS) {
      const dependencies = manifest[section]
      if (isObject(dependencies) && name in dependencies) problems.push(`${name} is in ${section}`)
    }
    if (bundled.includes(name)) problems.push(`${name} is bundled`)
    if (name in peerDependencies && peerDependencies[name] !== '*') {
      problems.push(`${name} peer range is ${String(peerDependencies[name])}, not "*"`)
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `${packageName} must declare Pi's host-provided packages as "*" peer dependencies: ${problems.join('; ')}.`,
    )
  }
}
