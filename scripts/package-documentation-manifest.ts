import type {
  PackageDocumentationDefinition,
  VersionedPackageDocumentationDefinition,
} from './package-documentation-model'

export interface PackageManifest {
  readonly bugs?: { readonly url?: string }
  readonly description?: string
  readonly exports?: Readonly<Record<string, unknown>>
  readonly homepage?: string
  readonly keywords?: readonly string[]
  readonly name?: string
  readonly repository?: { readonly directory?: string; readonly type?: string; readonly url?: string }
  readonly version?: string
}

interface JsonObject {
  readonly [key: string]: unknown
}

const SEMVER_DOCS_PART_COUNT = 2

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringArray(value: unknown) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    ? value
    : undefined
}

export function packageManifest(value: unknown): PackageManifest {
  if (!isJsonObject(value)) return {}
  const repository = isJsonObject(value.repository) ? value.repository : undefined
  const bugs = isJsonObject(value.bugs) ? value.bugs : undefined
  return {
    bugs: bugs && typeof bugs.url === 'string' ? { url: bugs.url } : undefined,
    description: typeof value.description === 'string' ? value.description : undefined,
    exports: isJsonObject(value.exports) ? value.exports : undefined,
    homepage: typeof value.homepage === 'string' ? value.homepage : undefined,
    keywords: stringArray(value.keywords),
    name: typeof value.name === 'string' ? value.name : undefined,
    repository: repository
      ? {
          directory:
            typeof repository.directory === 'string' ? repository.directory : undefined,
          type: typeof repository.type === 'string' ? repository.type : undefined,
          url: typeof repository.url === 'string' ? repository.url : undefined,
        }
      : undefined,
    version: typeof value.version === 'string' ? value.version : undefined,
  }
}

export function packageManifestDocumentationViolations(
  manifest: PackageManifest,
  definition: VersionedPackageDocumentationDefinition,
  docsUrl: string,
) {
  const violations: string[] = []
  if (manifest.name !== definition.packageName) violations.push('name')
  if (
    manifest.version?.split('.').slice(0, SEMVER_DOCS_PART_COUNT).join('.')
    !== definition.currentVersion
  ) {
    violations.push('docs version')
  }
  if (manifest.description !== definition.description) violations.push('description')
  if (manifest.homepage !== docsUrl) violations.push('homepage')
  if (manifest.bugs?.url !== 'https://github.com/OpenWaggle/OpenWaggle/issues') {
    violations.push('bugs')
  }
  if (
    manifest.repository?.type !== 'git'
    || manifest.repository.url !== 'https://github.com/OpenWaggle/OpenWaggle.git'
    || manifest.repository.directory !== `packages/${definition.slug}`
  ) {
    violations.push('repository')
  }
  if (JSON.stringify(manifest.keywords) !== JSON.stringify(definition.keywords)) {
    violations.push('keywords')
  }
  return violations
}

export function withPackageDocumentationMetadata(
  value: unknown,
  definition: PackageDocumentationDefinition,
  docsUrl: string,
) {
  if (!isJsonObject(value)) {
    throw new Error(`${definition.packageName} package manifest must be an object.`)
  }
  return {
    ...value,
    name: definition.packageName,
    description: definition.description,
    keywords: definition.keywords,
    homepage: docsUrl,
    repository: {
      ...(isJsonObject(value.repository) ? value.repository : {}),
      type: 'git',
      url: 'https://github.com/OpenWaggle/OpenWaggle.git',
      directory: `packages/${definition.slug}`,
    },
    bugs: {
      ...(isJsonObject(value.bugs) ? value.bugs : {}),
      url: 'https://github.com/OpenWaggle/OpenWaggle/issues',
    },
  }
}
