import { assertCanonicalDirectoryRoots } from './canonical-directory-roots'
import { isPathInsideDirectory } from './project-path-validation'

export async function assertFilesystemReadDirectoryScope(input: {
  readonly roots: readonly string[]
  readonly directoryPath: string
  readonly label: string
}) {
  const [canonicalDirectory] = await assertCanonicalDirectoryRoots(
    [input.directoryPath],
    input.label,
  )
  if (
    !canonicalDirectory ||
    !input.roots.some((root) => isPathInsideDirectory(root, canonicalDirectory))
  ) {
    throw new Error(`${input.label} is outside the granted filesystem scope.`)
  }
  return canonicalDirectory
}
