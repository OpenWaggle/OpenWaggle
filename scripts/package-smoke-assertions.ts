const REQUIRED_PACKAGE_FILES = [
  'CHANGELOG.md',
  'LICENSE',
  'README.md',
  'dist-cjs/package.json',
  'dist/index.d.ts',
  'dist/index.js',
  'package.json',
]

const REPOSITORY_URL = 'https://github.com/OpenWaggle/OpenWaggle.git'
const TEST_ARTIFACT_SUFFIXES = [
  '.component.d.ts',
  '.component.js',
  '.e2e.d.ts',
  '.e2e.js',
  '.integration.d.ts',
  '.integration.js',
  '.spec.d.ts',
  '.spec.js',
  '.test.d.ts',
  '.test.js',
  '.unit.d.ts',
  '.unit.js',
]
const TEST_ARTIFACT_SEGMENTS = [
  '__tests__',
  'component',
  'e2e',
  'integration',
  'test',
  'tests',
  'unit',
]
const TEST_ARTIFACT_NAME = /(?:^|[._-])(?:component|e2e|integration|spec|test|tests|unit)(?:[._-]|$)/
const SENSITIVE_ARTIFACT_NAME =
  /(?:^|[._-])(?:api[-_]?key|credential(?:s)?|private[-_]?key|secret(?:s)?|token)(?:[._-]|$)/

const PACKED_WORKSPACE_DEPENDENCIES = {
  '@openwaggle/extension-react': '@openwaggle/extension-sdk',
  '@openwaggle/pi-waggle': '@openwaggle/waggle-core',
} as const

export function parsePnpmPackTarballPath(stdout: string) {
  const parsed: unknown = JSON.parse(stdout)

  if (isObject(parsed) && typeof parsed.filename === 'string') {
    return parsed.filename
  }

  throw new Error('pnpm pack did not report a tarball filename.')
}

export function isObject(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function packageRelativePath(value: string) {
  return value.startsWith('./') ? value.slice('./'.length) : value
}

function collectPackagePaths(value: unknown): readonly string[] {
  if (typeof value === 'string') {
    return value.startsWith('./') ? [packageRelativePath(value)] : []
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectPackagePaths)
  }

  if (isObject(value)) {
    return Object.values(value).flatMap(collectPackagePaths)
  }

  return []
}

export function uniqueSorted(values: readonly string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function esmModuleArtifactPath(filePath: string) {
  return (
    filePath.startsWith('dist/') && (filePath.endsWith('.js') || filePath.endsWith('.d.ts'))
  )
}

function commonJsModuleArtifactPath(filePath: string) {
  return filePath.startsWith('dist-cjs/') && filePath.endsWith('.js')
}

function testArtifactPath(filePath: string) {
  const pathSegments = filePath.toLowerCase().split('/')
  const fileName = pathSegments.at(-1)

  return (
    pathSegments.some((segment) => TEST_ARTIFACT_SEGMENTS.includes(segment)) ||
    (fileName !== undefined &&
      (TEST_ARTIFACT_NAME.test(fileName) || SENSITIVE_ARTIFACT_NAME.test(fileName))) ||
    TEST_ARTIFACT_SUFFIXES.some((suffix) => filePath.endsWith(suffix))
  )
}

function allowedTarballFile(packageName: string, filePath: string) {
  if (filePath === 'dist-cjs/package.json') return true
  if ((esmModuleArtifactPath(filePath) || commonJsModuleArtifactPath(filePath)) && !testArtifactPath(filePath)) {
    return true
  }

  if (
    filePath === 'package.json' ||
    filePath === 'README.md' ||
    filePath === 'CHANGELOG.md' ||
    filePath === 'LICENSE'
  ) {
    return true
  }

  return packageName === '@openwaggle/extension-react' && filePath === 'styles.css'
}

export function collectManifestPackagePaths(manifest: unknown) {
  if (!isObject(manifest)) {
    return []
  }

  const piPaths = isObject(manifest.pi) ? collectPackagePaths(manifest.pi.extensions) : []

  return uniqueSorted([
    ...collectPackagePaths(manifest.exports),
    ...collectPackagePaths(manifest.types),
    ...piPaths,
  ])
}

export function assertPackedPackageFiles(input: {
  readonly packageName: string
  readonly manifest: unknown
  readonly files: readonly string[]
}) {
  const packageFiles = new Set(input.files)
  const missing = [...REQUIRED_PACKAGE_FILES, ...collectManifestPackagePaths(input.manifest)].filter(
    (path) => !packageFiles.has(path),
  )
  const disallowed = input.files.filter((filePath) => !allowedTarballFile(input.packageName, filePath))
  const issues = [
    ...uniqueSorted(missing).map((path) => `missing ${path}`),
    ...uniqueSorted(disallowed).map((path) => `contains disallowed file ${path}`),
  ]

  if (issues.length > 0) {
    throw new Error(`${input.packageName} tarball is invalid: ${issues.join('; ')}.`)
  }
}

export function assertPackedPackageMetadata(manifest: unknown, packageDirectory: string) {
  if (!isObject(manifest)) {
    throw new Error(`${packageDirectory} packed manifest must be an object.`)
  }

  if (manifest.license !== 'MIT') {
    throw new Error(`${packageDirectory} packed manifest must declare MIT license.`)
  }

  if (!isObject(manifest.engines) || manifest.engines.node !== '>=22.19.0') {
    throw new Error(`${packageDirectory} packed manifest must require Node.js >=22.19.0.`)
  }

  if (!isObject(manifest.publishConfig) || manifest.publishConfig.access !== 'public') {
    throw new Error(`${packageDirectory} packed manifest must publish with public access.`)
  }

  if (!isObject(manifest.repository)) {
    throw new Error(`${packageDirectory} packed manifest must declare repository metadata.`)
  }

  if (
    manifest.repository.type !== 'git' ||
    manifest.repository.url !== REPOSITORY_URL ||
    manifest.repository.directory !== packageDirectory
  ) {
    throw new Error(`${packageDirectory} packed manifest has incorrect repository metadata.`)
  }

}

function stringProperty(value: unknown, key: string) {
  return isObject(value) && typeof value[key] === 'string' ? value[key] : undefined
}

export function assertDualModuleExports(packageName: string, manifest: unknown) {
  if (!isObject(manifest) || !isObject(manifest.exports)) {
    throw new Error(`${packageName} packed manifest must declare exports.`)
  }

  for (const [exportPath, target] of Object.entries(manifest.exports)) {
    if (exportPath.endsWith('.css')) continue

    if (
      !isObject(target) ||
      stringProperty(target, 'types') === undefined ||
      stringProperty(target, 'import') === undefined ||
      stringProperty(target, 'require') === undefined
    ) {
      throw new Error(
        `${packageName} export ${exportPath} must provide types, import, and require targets.`,
      )
    }
  }
}

export function assertPackedWorkspaceDependencyRanges(
  packageName: string,
  manifest: unknown,
  packedPackageVersions: readonly { readonly name: string; readonly version: string }[],
) {
  const dependencyName =
    packageName === '@openwaggle/extension-react'
      ? PACKED_WORKSPACE_DEPENDENCIES['@openwaggle/extension-react']
      : packageName === '@openwaggle/pi-waggle'
        ? PACKED_WORKSPACE_DEPENDENCIES['@openwaggle/pi-waggle']
        : undefined
  if (!dependencyName) return

  if (!isObject(manifest) || !isObject(manifest.dependencies)) {
    throw new Error(`${packageName} packed manifest must declare dependencies.`)
  }

  const packedDependency = packedPackageVersions.find(
    (packedPackage) => packedPackage.name === dependencyName,
  )
  if (!packedDependency) {
    throw new Error(`${packageName} packed manifest is missing packed dependency ${dependencyName}.`)
  }

  if (manifest.dependencies[dependencyName] !== `^${packedDependency.version}`) {
    throw new Error(
      `${packageName} packed manifest must pack ${dependencyName} as a caret range for its packed version.`,
    )
  }
}
