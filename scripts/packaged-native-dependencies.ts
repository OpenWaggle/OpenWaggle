/**
 * Finds native optional dependencies a packaged app needs for its own platform and architecture
 * but does not ship. Packages such as sharp, @napi-rs/keyring and @mariozechner/clipboard load a
 * per-platform package (`@img/sharp-darwin-x64`) declared in `optionalDependencies`; when the build
 * host only installed the other architecture, the app packs without it and the feature breaks at
 * runtime. Every package.json in the packaged app directory, the app's own included, is read.
 */

/** A packaged app's files by `/`-rooted path, and a way to read one. */
export interface PackagedAppFiles {
  readonly files: ReadonlySet<string>
  readonly readFile: (file: string) => Promise<Buffer>
}

type PackagedPlatform = 'darwin' | 'linux' | 'win32'

const PACKAGE_JSON =
  /^(?:\/node_modules\/(?:.+\/node_modules\/)?((?:@[^/]+\/)?[^/]+))?\/package\.json$/u
const PLATFORM_PACKAGE =
  /-(?<platform>darwin|linux|win32)-(?<arch>x64|arm64|ia32|arm|ppc64|s390x|riscv64|loong64)(?:-(?<toolchain>[a-z0-9]+))?$/u
/** Toolchain suffixes that load on the supported targets; musl builds never do (glibc floor). */
const COMPATIBLE_SUFFIXES = new Set(['gnu', 'msvc'])

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const optionalDependenciesSchema = Schema.Struct({ optionalDependencies: unknownField })

export function isNativePackageFor(name: string, platform: PackagedPlatform, architecture: string) {
  const { platform: packagePlatform, arch, toolchain } = PLATFORM_PACKAGE.exec(name)?.groups ?? {}
  if (packagePlatform !== platform || arch !== architecture) return false
  return toolchain === undefined || COMPATIBLE_SUFFIXES.has(toolchain)
}

export async function missingNativeDependencies(
  archive: PackagedAppFiles,
  platform: PackagedPlatform,
  architecture: string,
) {
  const manifests = [...archive.files].flatMap((file) => {
    const match = PACKAGE_JSON.exec(file)
    return match === null ? [] : [{ file, name: match[1] ?? 'the app' }]
  })
  const shipped = new Set(manifests.map((manifest) => manifest.name))
  const missing = new Map<string, string>()
  for (const manifest of manifests) {
    const parsed: unknown = JSON.parse((await archive.readFile(manifest.file)).toString('utf8'))
    const declared = objectFields(optionalDependenciesSchema, parsed)?.optionalDependencies
    const optional = isRecord(declared) ? declared : {}
    for (const dependency of Object.keys(optional)) {
      if (!isNativePackageFor(dependency, platform, architecture) || shipped.has(dependency)) {
        continue
      }
      if (!missing.has(dependency)) missing.set(dependency, manifest.name)
    }
  }
  return [...missing].map(
    ([dependency, owner]) =>
      `${dependency}, which ${owner} needs on ${platform}-${architecture}, is not in the app`,
  )
}
