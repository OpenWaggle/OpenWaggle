import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DOCS_ROOT = fileURLToPath(new URL('../../content/docs/', import.meta.url))
/** Pending package lines, which Release Please copies to `docs/packages/<package>/<line>/` unchanged. */
export const PENDING_PACKAGE_DOCS_ROOT = fileURLToPath(
  new URL('../../content/package-docs-next/', import.meta.url),
)
/** Stands in for the version line a pending page has not been given yet. */
export const PENDING_LINE = 'next'

export interface DocsPageFile {
  /** The collection slug, or for a pending page the slug it gets once promoted. */
  readonly slug: string
  readonly path: string
  readonly text: string
  readonly pending: boolean
}

function markdownFiles(root: string) {
  if (!existsSync(root)) return []
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.mdx?$/u.test(file))
    .map((file) => file.replaceAll('\\', '/'))
}

function read(path: string) {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n')
}

/**
 * Every docs page, and every pending package page as `packages/<package>/next/<page>`. Promotion
 * copies a pending page into the docs collection byte for byte, so it has to pass the same schema
 * and style rules first: a pending page that breaks them fails the release PR after merge, when
 * only a new pull request can fix it.
 */
export function docsPageFiles() {
  const published = markdownFiles(DOCS_ROOT).map((file) => ({
    slug: file.replace(/\.mdx?$/u, ''),
    path: join(DOCS_ROOT, file),
    text: read(join(DOCS_ROOT, file)),
    pending: false,
  }))
  const pending = markdownFiles(PENDING_PACKAGE_DOCS_ROOT).map((file) => {
    const [packageSlug = '', ...page] = file.replace(/\.mdx?$/u, '').split('/')
    return {
      slug: ['packages', packageSlug, PENDING_LINE, ...page].join('/'),
      path: join(PENDING_PACKAGE_DOCS_ROOT, file),
      text: read(join(PENDING_PACKAGE_DOCS_ROOT, file)),
      pending: true,
    }
  })
  return [...published, ...pending] satisfies DocsPageFile[]
}
