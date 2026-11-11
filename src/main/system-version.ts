import { readFileSync } from 'node:fs'
import { release } from 'node:os'

/**
 * The operating system's version as Electron's `process.getSystemVersion()` reported it: the
 * product version on macOS (`26.1`, not the Darwin kernel's `25.1.0`), and the kernel release
 * elsewhere (`10.0.26100` on Windows).
 */
const MACOS_SYSTEM_VERSION_PLIST = '/System/Library/CoreServices/SystemVersion.plist'
const MACOS_PRODUCT_VERSION = /<key>ProductVersion<\/key>\s*<string>([^<]+)<\/string>/u

export function systemVersion(
  platform: NodeJS.Platform = process.platform,
  readPlist: () => string = () => readFileSync(MACOS_SYSTEM_VERSION_PLIST, 'utf8'),
) {
  if (platform !== 'darwin') return release()
  try {
    return MACOS_PRODUCT_VERSION.exec(readPlist())?.[1] ?? release()
  } catch {
    return release()
  }
}
