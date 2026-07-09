const REQUIRED_PACKAGE_FILES = [
  'README.md',
  'dist-cjs/package.json',
  'dist/index.d.ts',
  'dist/index.js',
  'package.json',
]

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

function sourceOnlyFile(path: string) {
  return (
    path.startsWith('src/') ||
    path.includes('/__tests__/') ||
    path.endsWith('.tsbuildinfo') ||
    path.startsWith('tsconfig') ||
    (path.endsWith('.ts') && !path.endsWith('.d.ts')) ||
    path.endsWith('.tsx')
  )
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
  const leaked = input.files.filter(sourceOnlyFile)
  const issues = [
    ...uniqueSorted(missing).map((path) => `missing ${path}`),
    ...uniqueSorted(leaked).map((path) => `contains source-only file ${path}`),
  ]

  if (issues.length > 0) {
    throw new Error(`${input.packageName} tarball is invalid: ${issues.join('; ')}.`)
  }
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
