import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'

/** The schema version of `manifest.json` and of an installed component's `component.json`. */
export const CEF_COMPONENT_SCHEMA_VERSION = 1

const SHA256_PATTERN = /^[0-9a-f]{64}$/
/** A CEF version names a directory, so it may not hold a path separator or `..`. */
const CEF_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/

function isDownloadUrl(value: string) {
  try {
    const { protocol } = new URL(value)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

export const CefSha256Schema = Schema.String.pipe(Schema.pattern(SHA256_PATTERN))
export const CefVersionSchema = Schema.String.pipe(Schema.pattern(CEF_VERSION_PATTERN))
export const CefComponentArchSchema = Schema.Literal('arm64', 'x64')
export type CefComponentArch = typeof CefComponentArchSchema.Type

const CefComponentAssetSchema = Schema.Struct({
  url: Schema.String.pipe(
    Schema.filter(isDownloadUrl, { message: () => 'an http(s) download URL' }),
  ),
  sha256: CefSha256Schema,
  size: Schema.Number.pipe(Schema.int(), Schema.positive()),
})

const CefComponentManifestSchema = Schema.Struct({
  schemaVersion: Schema.Literal(CEF_COMPONENT_SCHEMA_VERSION),
  cefVersion: CefVersionSchema,
  assets: Schema.Struct({
    'darwin-arm64': CefComponentAssetSchema,
    'darwin-x64': CefComponentAssetSchema,
  }),
})

export type CefComponentManifest = typeof CefComponentManifestSchema.Type
export type CefComponentAsset = typeof CefComponentAssetSchema.Type

/** The pinned component for one machine: the archive to fetch and the record it installs. */
export interface CefComponentTarget {
  readonly cefVersion: string
  readonly arch: CefComponentArch
  readonly asset: CefComponentAsset
}

/** Decodes the committed manifest; it throws the issues when a build wrote a malformed one. */
export function decodeCefComponentManifest(value: unknown): CefComponentManifest {
  return decodeUnknownExactOrThrow(CefComponentManifestSchema, value)
}

/** The macOS architectures the component exists for; `null` for any other. */
export function cefComponentArch(arch: string): CefComponentArch | null {
  if (arch === 'arm64' || arch === 'x64') return arch
  return null
}

export function cefComponentTarget(
  manifest: CefComponentManifest,
  arch: CefComponentArch,
): CefComponentTarget {
  return { cefVersion: manifest.cefVersion, arch, asset: manifest.assets[`darwin-${arch}`] }
}
