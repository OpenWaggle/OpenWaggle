import { Schema, type SchemaType } from '@shared/schema'
import { lenientExactOptional } from '@shared/schemas/lenient-exact'
import { jsonValueSchema } from '@shared/schemas/validation'
import { objectFields, unknownField } from './support/object-fields'
import type {
  PackageDocumentationDefinition,
  VersionedPackageDocumentationDefinition,
} from './package-documentation-model'

type JsonObject = Readonly<Record<string, unknown>>

const SEMVER_DOCS_PART_COUNT = 2

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
/**
 * The `package.json` metadata the docs check reads. A field that is missing or of the wrong type
 * is left out, never set to undefined.
 */
const packageManifestSchema = Schema.Struct({
  bugs: lenientExactOptional(Schema.Struct({ url: lenientExactOptional(Schema.String) })),
  description: lenientExactOptional(Schema.String),
  exports: lenientExactOptional(
    // A runtime-keyed map: each subpath to its export target.
    Schema.Record({ key: Schema.String, value: jsonValueSchema }).pipe(
      Schema.filter((exportsValue) => !Array.isArray(exportsValue)),
    ),
  ),
  homepage: lenientExactOptional(Schema.String),
  keywords: lenientExactOptional(Schema.Array(Schema.String)),
  name: lenientExactOptional(Schema.String),
  repository: lenientExactOptional(
    Schema.Struct({
      directory: lenientExactOptional(Schema.String),
      type: lenientExactOptional(Schema.String),
      url: lenientExactOptional(Schema.String),
    }),
  ),
  version: lenientExactOptional(Schema.String),
})

export type PackageManifest = SchemaType<typeof packageManifestSchema>

export function packageManifest(value: unknown) {
  const manifest: PackageManifest = isJsonObject(value)
    ? Schema.decodeUnknownSync(packageManifestSchema)(value)
    : {}
  return manifest
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
