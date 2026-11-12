import { Schema } from '@shared/schema'
import { objectFields, unknownField } from './support/object-fields'
import type {
  PackageDocumentationDefinition,
  VersionedPackageDocumentationDefinition,
} from './package-documentation-model'

export interface PackageManifest {
  readonly bugs?: { readonly url?: string | undefined } | undefined
  readonly description?: string | undefined
  readonly exports?: Readonly<Record<string, unknown>> | undefined
  readonly homepage?: string | undefined
  readonly keywords?: readonly string[] | undefined
  readonly name?: string | undefined
  readonly repository?:
    | {
        readonly directory?: string | undefined
        readonly type?: string | undefined
        readonly url?: string | undefined
      }
    | undefined
  readonly version?: string | undefined
}

type JsonObject = Readonly<Record<string, unknown>>

const SEMVER_DOCS_PART_COUNT = 2

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringArray(value: unknown) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    ? value
    : undefined
}

/** The `package.json` fields the docs metadata reads; a field of the wrong type reads as absent. */
const manifestFieldsSchema = Schema.Struct({
  bugs: unknownField,
  description: unknownField,
  exports: unknownField,
  homepage: unknownField,
  keywords: unknownField,
  name: unknownField,
  repository: unknownField,
  version: unknownField,
})
const urlFieldSchema = Schema.Struct({ url: unknownField })
const repositoryFieldsSchema = Schema.Struct({
  directory: unknownField,
  type: unknownField,
  url: unknownField,
})

function stringField(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

export function packageManifest(value: unknown): PackageManifest {
  const manifest = objectFields(manifestFieldsSchema, value)
  if (manifest === undefined) return {}
  const repository = objectFields(repositoryFieldsSchema, manifest.repository)
  const bugsUrl = stringField(objectFields(urlFieldSchema, manifest.bugs)?.url)
  return {
    bugs: bugsUrl === undefined ? undefined : { url: bugsUrl },
    description: stringField(manifest.description),
    exports: isJsonObject(manifest.exports) ? manifest.exports : undefined,
    homepage: stringField(manifest.homepage),
    keywords: stringArray(manifest.keywords),
    name: stringField(manifest.name),
    repository: repository
      ? {
          directory: stringField(repository.directory),
          type: stringField(repository.type),
          url: stringField(repository.url),
        }
      : undefined,
    version: stringField(manifest.version),
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
    manifest.version?.split('.').slice(0, SEMVER_DOCS_PART_COUNT).join('.') !==
    definition.currentVersion
  ) {
    violations.push('docs version')
  }
  if (manifest.description !== definition.description) violations.push('description')
  if (manifest.homepage !== docsUrl) violations.push('homepage')
  if (manifest.bugs?.url !== 'https://github.com/OpenWaggle/OpenWaggle/issues') {
    violations.push('bugs')
  }
  if (
    manifest.repository?.type !== 'git' ||
    manifest.repository.url !== 'https://github.com/OpenWaggle/OpenWaggle.git' ||
    manifest.repository.directory !== `packages/${definition.slug}`
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
  const manifest = objectFields(manifestFieldsSchema, value)
  if (!isJsonObject(value) || manifest === undefined) {
    throw new Error(`${definition.packageName} package manifest must be an object.`)
  }
  return {
    ...value,
    name: definition.packageName,
    description: definition.description,
    keywords: definition.keywords,
    homepage: docsUrl,
    repository: {
      ...(isJsonObject(manifest.repository) ? manifest.repository : {}),
      type: 'git',
      url: 'https://github.com/OpenWaggle/OpenWaggle.git',
      directory: `packages/${definition.slug}`,
    },
    bugs: {
      ...(isJsonObject(manifest.bugs) ? manifest.bugs : {}),
      url: 'https://github.com/OpenWaggle/OpenWaggle/issues',
    },
  }
}
