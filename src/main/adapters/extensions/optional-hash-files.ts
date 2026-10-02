import { readFile, stat } from 'node:fs/promises'
import { SVG_ICON_MAX_BYTES } from '../../domain/extension-panel-icon/svg-icon-sanitizer'
import { normalizeManifestRelativePath } from './content-hash-input'
import { resolveSafePackageFilePath } from './package-relative-paths'

/** Optional files are only ever small assets such as side panel SVG icons. */
const OPTIONAL_FILE_MAX_BYTES = SVG_ICON_MAX_BYTES
const MISSING_MARKER = 'missing'
const OVERSIZED_MARKER = 'oversized'

export interface OptionalHashFile {
  readonly relativePath: string
  /** File bytes, or a marker so that adding, removing or shrinking the file changes the hash. */
  readonly content: Buffer | string
}

async function readOptionalHashFile(packagePath: string, relativePath: string) {
  try {
    const filePath = await resolveSafePackageFilePath(packagePath, relativePath)
    if (filePath === null) return MISSING_MARKER
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) return MISSING_MARKER
    if (fileStat.size > OPTIONAL_FILE_MAX_BYTES) return OVERSIZED_MARKER
    return await readFile(filePath)
  } catch {
    // An unreadable optional file is reported where it is used (the icon resolver), not here.
    return MISSING_MARKER
  }
}

/** Reads optional package files in a stable order. Missing files never fail the content hash. */
export async function readOptionalHashFiles(
  packagePath: string,
  relativePaths: readonly string[],
): Promise<readonly OptionalHashFile[]> {
  const uniquePaths = [...new Set(relativePaths.map(normalizeManifestRelativePath))].sort(
    (left, right) => left.localeCompare(right),
  )
  return Promise.all(
    uniquePaths.map(async (relativePath) => ({
      relativePath,
      content: await readOptionalHashFile(packagePath, relativePath),
    })),
  )
}
