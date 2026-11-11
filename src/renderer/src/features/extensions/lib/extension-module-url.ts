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

function encodeSessionContext(sessionId: string) {
  return encodePathSegment(JSON.stringify({ sessionId }))
}

/**
 * The URL of an entry's runtime module under `runtimeBase`, the extension runtime's trusted origin
 * base main passed this window (`window.api.getTrustedOriginBases()`): `openwaggle-extension://runtime`
 * on Electron, a loopback base with a capability path on Electrobun. Null without an entry path.
 */
export function createExtensionModuleUrl(
  entry: ExtensionContributionRegistryEntry,
  runtimeBase: string,
) {
  if (!entry.entryPath) {
    return null
  }

  const protocol = OPENWAGGLE_EXTENSION.RUNTIME_MODULE_PROTOCOL
  const encodedPackagePath = encodePathSegment(entry.packagePath)
  const encodedContentHash = encodePathSegment(entry.contentHash)
  const encodedProjectPaths = encodeProjectPathsContext(entry.projectPaths)
  const contextSegments =
    entry.sessionId !== undefined
      ? [protocol.MODULE_CONTEXT_SEGMENT, encodeSessionContext(entry.sessionId)]
      : []
  const encodedEntryPath = encodeRelativePath(entry.entryPath)

  return [
    `${runtimeBase}${protocol.MODULE_PATH_PREFIX}`,
    encodedPackagePath,
    encodedContentHash,
    encodedProjectPaths,
    ...contextSegments,
    encodedEntryPath,
  ].join('/')
}
