import { describe, expect, it } from 'vitest'
import { docsFrontmatterSchema, parseMarkdownFrontmatter } from '../docs-frontmatter'
import { docsPageFiles } from './docs-page-files'

// The website build parses every page in src/content/docs with this schema. Pending package pages are
// checked here too: Release Please promotes them into the docs on its release branch after merge,
// where a missing `kind` fails the build and the package release with it.

function schemaIssues(text: string) {
  const result = docsFrontmatterSchema.safeParse(parseMarkdownFrontmatter(text).data)
  return result.success
    ? []
    : result.error.issues.map(
        (issue) => `${issue.path.join('.') || '(frontmatter)'}: ${issue.message}`,
      )
}

describe('docs frontmatter', () => {
  it('rejects a page without a kind, or with a kind outside the enum', () => {
    const page = (kind: string) =>
      ['---', 'title: "A page"', 'section: "Packages"', kind, '---', 'Body.'].join('\n')
    expect(schemaIssues(page('kind: "guide"'))).toEqual([])
    expect(schemaIssues(page('order: 1'))).toHaveLength(1)
    expect(schemaIssues(page('kind: "tutorial"'))).toHaveLength(1)
  })

  it('matches the docs collection schema on every published and pending page', () => {
    const offenders = docsPageFiles().flatMap((page) =>
      schemaIssues(page.text).map(
        (issue) => `${page.slug}${page.pending ? ' (pending)' : ''}: ${issue}`,
      ),
    )
    expect(offenders).toEqual([])
  })
})
