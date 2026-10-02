import type { Hash } from 'node:crypto'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { SVG_ICON_MAX_BYTES } from '../../domain/extension-panel-icon/svg-icon-sanitizer'
import { readBoundedFile } from './bounded-file-read'
import { normalizeManifestRelativePath } from './content-hash-input'
import { resolveSafePackageFilePath } from './package-relative-paths'

/** Optional files are only ever small assets such as side panel SVG icons. */
const OPTIONAL_FILE_MAX_BYTES = SVG_ICON_MAX_BYTES

/**
 * An optional file's hashed state. Missing and oversized files are hashed as their state alone,
 * so adding, removing or shrinking the file changes the hash without failing it.
 */
type OptionalHashFile =
  | { readonly relativePath: string; readonly state: 'present'; readonly content: Buffer }
  | { readonly relativePath: string; readonly state: 'missing' | 'oversized' }

type OptionalHashFileContent =
  | { readonly state: 'present'; readonly content: Buffer }
  | { readonly state: 'missing' | 'oversized' }

const MISSING: OptionalHashFileContent = { state: 'missing' }

async function readOptionalHashFile(
  packagePath: string,
  relativePath: string,
): Promise<OptionalHashFileContent> {
  try {
    const filePath = await resolveSafePackageFilePath(packagePath, relativePath)
    if (filePath === null) return MISSING
    const read = await readBoundedFile(filePath, OPTIONAL_FILE_MAX_BYTES)
    if (read.kind === 'not-file') return MISSING
    if (read.kind === 'oversized') return { state: 'oversized' }
    return { state: 'present', content: read.content }
  } catch {
    // An unreadable optional file is reported where it is used (the icon resolver), not here.
    return MISSING
  }
}

/**
 * The label hashed before an optional file's content. A present file's label carries its byte
 * length, so no file content can be mistaken for a missing or oversized state or vice versa.
 */
function optionalHashFileStateLabel(file: OptionalHashFile) {
  return file.state === 'present' ? `present:${String(file.content.byteLength)}` : file.state
}

/** Reads optional package files in a stable order. Missing files never fail the content hash. */
async function readOptionalHashFiles(
  packagePath: string,
  relativePaths: readonly string[],
): Promise<readonly OptionalHashFile[]> {
  const uniquePaths = [...new Set(relativePaths.map(normalizeManifestRelativePath))].sort(
    (left, right) => left.localeCompare(right),
  )
  return Promise.all(
    uniquePaths.map(
      async (relativePath): Promise<OptionalHashFile> => ({
        relativePath,
        ...(await readOptionalHashFile(packagePath, relativePath)),
      }),
    ),
  )
}

/** Hashes each optional file as its path, its state label and, when present, its bytes. */
export async function updateHashWithOptionalFiles(
  hash: Hash,
  packagePath: string,
  relativePaths: readonly string[],
) {
  const { FIELD_SEPARATOR, OPTIONAL_FILE_LABEL } = OPENWAGGLE_EXTENSION.HASH
  for (const optionalFile of await readOptionalHashFiles(packagePath, relativePaths)) {
    hash.update(OPTIONAL_FILE_LABEL)
    hash.update(FIELD_SEPARATOR)
    hash.update(optionalFile.relativePath)
    hash.update(FIELD_SEPARATOR)
    hash.update(optionalHashFileStateLabel(optionalFile))
    hash.update(FIELD_SEPARATOR)
    if (optionalFile.state === 'present') {
      hash.update(optionalFile.content)
      hash.update(FIELD_SEPARATOR)
    }
  }
}
