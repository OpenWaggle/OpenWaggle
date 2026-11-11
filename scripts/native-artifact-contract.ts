export interface NativeArtifactRuntime {
  readonly platform: NodeJS.Platform
  readonly arch: string
  readonly libc: 'glibc' | 'musl'
}

export interface NativeArtifactCandidate {
  readonly packageName: string
  readonly relativePath: string
}

export interface NativeArtifactRequirement {
  readonly label: string
  readonly candidates: readonly NativeArtifactCandidate[]
  readonly executable?: boolean
}

const VERSION_TOKEN = '{version}'

export function currentNativeArtifactRuntime() {
  return {
    platform: process.platform,
    arch: process.arch,
    libc: currentLinuxLibc(),
  }
}

export function nativeArtifactRequirements(packageName: string, runtime: NativeArtifactRuntime) {
  if (packageName === 'better-sqlite3') return betterSqliteRequirements(runtime)
  if (packageName === 'sharp') return sharpRequirements(runtime)
  throw new Error(`No exact native artifact contract is defined for ${packageName}.`)
}

export function materializeNativeArtifactPath(
  template: string,
  packageVersion: string | undefined,
) {
  if (!template.includes(VERSION_TOKEN)) return template
  if (!packageVersion) {
    throw new Error(`Cannot resolve versioned native artifact path ${template}.`)
  }
  return template.replaceAll(VERSION_TOKEN, packageVersion)
}

function betterSqliteRequirements(
  runtime: NativeArtifactRuntime,
): readonly NativeArtifactRequirement[] {
  const target = nativeTarget(runtime)
  const requirement: readonly NativeArtifactRequirement[] = [
    {
      label: 'SQLite addon selected by better-sqlite3',
      candidates: [
        { packageName: 'better-sqlite3', relativePath: `prebuilds/${target}.node` },
        { packageName: 'better-sqlite3', relativePath: 'build/Debug/better_sqlite3.node' },
        { packageName: 'better-sqlite3', relativePath: 'build/Release/better_sqlite3.node' },
      ],
    },
  ]
  return requirement
}

function sharpRequirements(runtime: NativeArtifactRuntime) {
  const target = nativeTarget(runtime)
  const requirement: readonly NativeArtifactRequirement[] = [
    {
      label: 'Sharp addon selected for the active platform',
      candidates: [
        {
          packageName: 'sharp',
          relativePath: `src/build/Release/sharp-${target}-${VERSION_TOKEN}.node`,
        },
        {
          packageName: `@img/sharp-${target}`,
          relativePath: `lib/sharp-${target}-${VERSION_TOKEN}.node`,
        },
      ],
    },
  ]
  return requirement
}

function nativeTarget(runtime: NativeArtifactRuntime) {
  const platform =
    runtime.platform === 'linux' && runtime.libc === 'musl' ? 'linuxmusl' : runtime.platform
  return `${platform}-${runtime.arch}`
}

function currentLinuxLibc() {
  if (process.platform !== 'linux') return 'glibc' as const
  const report: unknown = process.report.getReport()
  if (typeof report !== 'object' || report === null || !('header' in report)) return 'musl' as const
  const { header } = report
  return typeof header === 'object' &&
    header !== null &&
    'glibcVersionRuntime' in header &&
    typeof header.glibcVersionRuntime === 'string'
    ? ('glibc' as const)
    : ('musl' as const)
}
