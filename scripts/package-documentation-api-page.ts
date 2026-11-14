import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { VersionedPackageDocumentationDefinition } from './package-documentation-model'
import {
  apiReferenceMatchesRecordedHash,
  generatedApiReferencePackageVersion,
} from './package-api-reference-renderer'

export function apiReferencePath(projectRoot: string, slug: string, version: string) {
  return path.join(
    projectRoot,
    'website',
    'src',
    'content',
    'docs',
    'packages',
    slug,
    version,
    'api-reference.md',
  )
}

export async function readIfPresent(filePath: string) {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Whether the current line's API page is generated: not while a pending line defers it, and not
 * once it lists the declarations of `packageVersion`, a released version. A page that is not
 * generated is frozen, and the check fails when it no longer matches the content hash its marker
 * recorded, so a hand edit to a released page cannot pass.
 */
export async function apiReferenceState(input: {
  readonly projectRoot: string
  readonly definition: VersionedPackageDocumentationDefinition
  readonly packageVersion: string
  readonly deferred: boolean
}) {
  const pagePath = apiReferencePath(
    input.projectRoot,
    input.definition.slug,
    input.definition.currentVersion,
  )
  const page = await readIfPresent(pagePath)
  const generates =
    !input.deferred &&
    (page === undefined || generatedApiReferencePackageVersion(page) !== input.packageVersion)
  const edited = !generates && page !== undefined && !apiReferenceMatchesRecordedHash(page)
  const outputPath = path.relative(input.projectRoot, pagePath).split(path.sep).join('/')
  const violations = edited
    ? [
        `${outputPath} no longer matches the content hash in its generated marker. A released API page changes only with its package version; restore it from git.`,
      ]
    : []
  return { generates, violations }
}
