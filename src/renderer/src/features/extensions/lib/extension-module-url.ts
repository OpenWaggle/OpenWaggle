import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'

function encodePathSegment(value: string) {
  return encodeURIComponent(value)
}

function normalizeEntryPath(entryPath: string) {
  return entryPath.replaceAll(
    OPENWAGGLE_EXTENSION.PATH.WINDOWS_SEPARATOR,
    OPENWAGGLE_EXTENSION.PATH.POSIX_SEPARATOR,
  )
}

function encodeRelativePath(relativePath: string) {
  return normalizeEntryPath(relativePath).split('/').map(encodePathSegment).join('/')
}

function encodeProjectPathsContext(projectPaths: readonly string[]) {
  return encodePathSegment(JSON.stringify(projectPaths))
}

export function createExtensionModuleUrl(entry: ExtensionContributionRegistryEntry) {
  if (!entry.entryPath) {
    return null
  }

  const protocol = OPENWAGGLE_EXTENSION.RUNTIME_MODULE_PROTOCOL
  const encodedPackagePath = encodePathSegment(entry.packagePath)
  const encodedContentHash = encodePathSegment(entry.contentHash)
  const encodedProjectPaths = encodeProjectPathsContext(entry.projectPaths)
  const encodedEntryPath = encodeRelativePath(entry.entryPath)

  return [
    `${protocol.SCHEME}://${protocol.HOST}${protocol.MODULE_PATH_PREFIX}`,
    encodedPackagePath,
    encodedContentHash,
    encodedProjectPaths,
    encodedEntryPath,
  ].join('/')
}
