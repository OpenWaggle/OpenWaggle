import { isObject } from './package-smoke-assertions'

const MINIMUM_PACKAGE_SMOKE_NODE_MAJOR = 22
const MINIMUM_PACKAGE_SMOKE_NODE_MINOR = 19

export function assertReactPeerDependencies(manifest: unknown) {
  const peerDependencies = isObject(manifest) && isObject(manifest.peerDependencies)
    ? manifest.peerDependencies
    : undefined
  const dependencies = isObject(manifest) && isObject(manifest.dependencies)
    ? manifest.dependencies
    : undefined

  for (const dependencyName of ['react', 'react-dom']) {
    if (peerDependencies?.[dependencyName] !== '^19.0.0') {
      throw new Error(`@openwaggle/extension-react must declare ${dependencyName} as a peer dependency.`)
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

export function findPackageDependencyVersion(manifest: unknown, dependencyName: string) {
  if (!isObject(manifest)) return undefined

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
