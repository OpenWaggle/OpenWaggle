import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { LoadExtensionsResult } from '@earendil-works/pi-coding-agent'
import { isRecord } from '@shared/utils/validation'

const PI_WAGGLE_PACKAGE_NAME = '@openwaggle/pi-waggle'

function packageName(directory: string) {
  try {
    const manifest: unknown = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
    return isRecord(manifest) && typeof manifest.name === 'string' ? manifest.name : undefined
  } catch {
    return undefined
  }
}

/** The name of the package an extension file belongs to: the nearest named `package.json`. */
function owningPackageName(filePath: string) {
  let directory = path.dirname(filePath)
  let name = packageName(directory)
  while (name === undefined && path.dirname(directory) !== directory) {
    directory = path.dirname(directory)
    name = packageName(directory)
  }
  return name
}

function isFileExtension(extensionPath: string) {
  return path.isAbsolute(extensionPath)
}

/**
 * The loaded extensions without an installed `@openwaggle/pi-waggle` package's. OpenWaggle runs
 * Waggle itself; that package's default extension, which a Pi user loads for the TUI, drops every
 * Waggle request and turn message from the model's context, starts its own Waggle Runs from the
 * Session's Waggle mode, and registers `/waggle`, so alongside OpenWaggle's Waggle it would take
 * the Run's messages away and run a second loop.
 */
export function withoutInstalledPiWaggle(base: LoadExtensionsResult): LoadExtensionsResult {
  const extensions = base.extensions.filter(
    (extension) =>
      !isFileExtension(extension.resolvedPath) ||
      owningPackageName(extension.resolvedPath) !== PI_WAGGLE_PACKAGE_NAME,
  )
  return extensions.length === base.extensions.length ? base : { ...base, extensions }
}
