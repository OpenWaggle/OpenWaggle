import { describe, expect, it } from 'vitest'
import { developerDocsNav, docsNav } from '../../data/docs-nav'
import { docsPageFiles } from './docs-page-files'

// ADR 0061 and .agents/skills/write-docs/SKILL.md: guides teach a task, reference pages list exact
// facts, overviews explain the model; screenshots appear once, without captions or numbered callouts;
// user docs use plain words in lowercase. A page that genuinely needs a banned word lists it in a
// `<!-- docs-style allow: word, other -->` comment, so the exception is visible in review.
// Set DOCS_STYLE_ONLY=using-openwaggle/,reference/ to check only pages whose slug starts with one of them.
// Pending package lines (src/content/package-docs-next/) are checked as `packages/<package>/next/<page>`,
// because Release Please promotes them into the docs unchanged.

const ONLY = (process.env.DOCS_STYLE_ONLY ?? '')
  .split(',')
  .map((prefix) => prefix.trim())
  .filter((prefix) => prefix.length > 0)

/** A guide table longer than this belongs on a reference page. */
const MAX_GUIDE_TABLE_ROWS = 12
const MAX_ALT_LENGTH = 160
const SPECIFICATION_WORDS = [
  'durable',
  'durably',
  'atomically',
  'atomic',
  'lineage',
  'authoritative',
  'idempotent',
  'workspace binding',
  'exact active run',
]
/** Glossary nouns that user docs write in lowercase unless they start a sentence or name a UI label. */
const LOWERCASE_NOUNS = [
  'Session',
  'Sessions',
  'Run',
  'Runs',
  'Worker',
  'Workers',
  'Follow-up',
  'Follow-ups',
  'Delegation',
  'Delegations',
  'Workspace',
  'Workspaces',
  'Steering',
]
/** Proper names that start with one of those nouns. */
const NAMES = ['Session Host', 'Session Summary', 'Session Tree', 'Session Hub', 'Run identity']

interface DocPage {
  readonly slug: string
  readonly kind: string
  readonly body: string
  /** The file's line number of the body's first line, so offenders name the line in the source. */
  readonly bodyLine: number
  readonly allowed: ReadonlySet<string>
}

/** Splits a page file into its frontmatter and body, and finds the line the body starts on. */
function splitPage(text: string) {
  const end = text.indexOf('\n---\n', 4)
  const head = text.slice(0, end + 5)
  return {
    frontmatter: text.slice(4, end),
    body: text.slice(end + 5),
    bodyLine: head.split('\n').length,
  }
}

function pages(): DocPage[] {
  return docsPageFiles()
    .map(({ slug, text }) => {
      const { frontmatter, body, bodyLine } = splitPage(text)
      const allowed = new Set(
        [...body.matchAll(/<!-- docs-style allow: ([^>]*?) -->/gu)].flatMap(([, words = '']) =>
          words.split(',').map((word) => word.trim().toLowerCase()),
        ),
      )
      return {
        slug,
        kind: /^kind: "?(\w+)"?$/mu.exec(frontmatter)?.[1] ?? '',
        body,
        bodyLine,
        allowed,
      }
    })
    .filter((page) => ONLY.length === 0 || ONLY.some((prefix) => page.slug.startsWith(prefix)))
}

/** Generated API references inventory type names; the prose rules do not apply to them. */
function isGenerated(page: DocPage) {
  return page.slug.startsWith('packages/') && page.slug.endsWith('/api-reference')
}

/** Only the line breaks of `text`, so removing a block keeps every later line where it was. */
function keepLineBreaks(text: string) {
  return text.replace(/[^\n]/gu, '')
}

/**
 * Body text without code, bold UI labels, link targets, HTML and images' addresses. Removed blocks
 * keep their line breaks, so an index into the result is on the same line as in the body.
 */
function prose(body: string) {
  return body
    .replace(/^( *)(```|~~~)[^\n]*\n[\s\S]*?^\1\2[^\n]*$/gmu, keepLineBreaks)
    .replace(/<!--[\s\S]*?-->/gu, keepLineBreaks)
    .replace(/`[^`\n]*`/gu, '')
    .replace(/\*\*[^*\n]+\*\*/gu, 'Label')
    .replace(/\]\([^)\s]*\)/gu, ']')
    .replace(/<[^>\n]+>/gu, '')
}

/** The source file's line number of `index` in the page body, or in its `prose()`. */
function lineOf(page: Pick<DocPage, 'bodyLine'>, text: string, index: number) {
  return page.bodyLine + text.slice(0, index).split('\n').length - 1
}

describe('docs style helpers', () => {
  const file = [
    '---',
    'title: "A page"',
    'kind: "guide"',
    '---',
    'Intro.',
    '',
    '```sh',
    'openwaggle',
    '```',
    '',
    'A Run here.',
  ].join('\n')

  it('names the line in the source file, after the frontmatter and any code block', () => {
    const page = splitPage(file)
    const text = prose(page.body)
    expect(page.bodyLine).toBe(5)
    expect(lineOf(page, text, text.indexOf('Run'))).toBe(11)
    expect(lineOf(page, page.body, page.body.indexOf('openwaggle'))).toBe(8)
  })
})

describe('docs page kinds', () => {
  const referenceSection = new Set(
    docsNav.find((section) => section.title === 'Reference')?.items.map((item) => item.slug),
  )
  const developerSlugs = developerDocsNav.flatMap((section) =>
    section.items.map((item) => item.slug),
  )
  const isDeveloperOrPackage = (slug: string) =>
    slug.startsWith('packages/') ||
    developerSlugs.some((devSlug) => slug === devSlug || slug.startsWith(`${devSlug}/`))

  it('gives every page a kind of guide, reference or overview', () => {
    expect(
      pages()
        .filter((page) => !['guide', 'reference', 'overview'].includes(page.kind))
        .map((page) => page.slug),
    ).toEqual([])
  })

  it('keeps user reference pages in the Reference section, and only reference pages there', () => {
    const misplaced = pages()
      .filter((page) => !isDeveloperOrPackage(page.slug))
      .filter((page) => (page.kind === 'reference') !== referenceSection.has(page.slug))
      .map((page) => `${page.slug} (${page.kind})`)
    expect(misplaced).toEqual([])
  })
})

describe('docs guide shape', () => {
  const guides = () => pages().filter((page) => page.kind === 'guide')

  it('opens every guide with a plain paragraph', () => {
    const offenders = guides().flatMap((page) => {
      const first =
        page.body
          .replace(/<!--[\s\S]*?-->/gu, '')
          .split('\n')
          .find((line) => line.trim().length > 0) ?? ''
      return /^(?:#|!\[|\||```|~~~|[-*] |\d+\. |<|>|_)/u.test(first.trim())
        ? [`${page.slug}: ${first.slice(0, 60)}`]
        : []
    })
    expect(offenders).toEqual([])
  })

  it(`moves tables longer than ${MAX_GUIDE_TABLE_ROWS} rows from guides to reference pages`, () => {
    const offenders = guides().flatMap((page) => {
      const tables = prose(page.body)
        .split(/\n(?!\|)/u)
        .filter((block) => block.startsWith('|'))
      return tables
        .map((table) => table.split('\n').filter((row) => row.startsWith('|')).length - 2)
        .filter((rows) => rows > MAX_GUIDE_TABLE_ROWS)
        .map((rows) => `${page.slug}: a ${rows}-row table`)
    })
    expect(offenders).toEqual([])
  })
})

describe('docs screenshots', () => {
  const images = () =>
    pages().flatMap((page) =>
      [...page.body.matchAll(/!\[([^\]]*)\]\(\/screenshots\/([\w.-]+\.png)\)/gu)].map((match) => ({
        slug: page.slug,
        alt: match[1] ?? '',
        image: match[2] ?? '',
        after: page.body.slice((match.index ?? 0) + match[0].length),
        line: lineOf(page, page.body, match.index ?? 0),
      })),
    )

  it('shows each screenshot on exactly one page, once', () => {
    const uses = new Map<string, string[]>()
    for (const { image, slug } of images()) uses.set(image, [...(uses.get(image) ?? []), slug])
    expect(
      [...uses]
        .filter(([, slugs]) => slugs.length > 1)
        .map(([image, slugs]) => `${image}: ${slugs.join(', ')}`),
    ).toEqual([])
  })

  it(`describes each screenshot in one sentence of at most ${MAX_ALT_LENGTH} characters`, () => {
    const offenders = images()
      .filter(
        ({ alt }) =>
          alt.length > MAX_ALT_LENGTH || /[.;:]\s+\S/u.test(alt) || /\bnumbered\b/iu.test(alt),
      )
      .map(({ slug, line, alt }) => `${slug}:${line} (${alt.length} chars): ${alt.slice(0, 80)}`)
    expect(offenders).toEqual([])
  })

  it('puts no caption under a screenshot', () => {
    const offenders = images()
      .filter(({ after }) => /^\n\n([_*])[^\n]+\1\s*(?:\n|$)/u.test(after))
      .map(({ slug, line }) => `${slug}:${line}`)
    expect(offenders).toEqual([])
  })

  it('never points at numbered callouts', () => {
    const offenders = pages().flatMap((page) =>
      [
        ...prose(page.body).matchAll(
          /\b(?:is|are|as|at) numbers? \d+\b|\bnumbered (?:controls|callouts|badges)\b/giu,
        ),
      ].map((match) => `${page.slug}: ${match[0]}`),
    )
    expect(offenders).toEqual([])
  })
})

describe('docs commands', () => {
  // `<session-id>` breaks when pasted, because the shell reads `<` as a redirect. Write SESSION_ID.
  it('writes shell blocks that paste as they are: no prompts, comments, continued lines or <placeholders>', () => {
    const offenders = pages().flatMap((page) =>
      [...page.body.matchAll(/^( *)```(?:bash|sh|shell|zsh|console)\n([\s\S]*?)^\1```/gmu)].flatMap(
        (match) => {
          const firstLine = lineOf(page, page.body, match.index ?? 0) + 1
          return (match[2] ?? '')
            .split('\n')
            .map((line, offset) => ({ line, number: firstLine + offset }))
            .filter(({ line }) => /^\s*(?:#|\$ |> )|\\$|<[A-Za-z][\w.-]*>/u.test(line))
            .map(({ line, number }) => `${page.slug}:${number} ${line.trim().slice(0, 60)}`)
        },
      ),
    )
    expect(offenders).toEqual([])
  })
})

describe('docs wording', () => {
  it('keeps specification words out of guides and overviews', () => {
    const offenders = pages()
      .filter((page) => page.kind !== 'reference')
      .flatMap((page) => {
        const text = prose(page.body).toLowerCase()
        return SPECIFICATION_WORDS.filter((word) => !page.allowed.has(word))
          .filter((word) => new RegExp(`\\b${word}\\b`, 'u').test(text))
          .map((word) => `${page.slug}: ${word}`)
      })
    expect(offenders).toEqual([])
  })

  it('uses no em dashes outside UI labels and code', () => {
    const offenders = pages()
      .filter((page) => !isGenerated(page))
      .flatMap((page) => {
        const text = prose(page.body)
        return [...text.matchAll(/\u2014/gu)].map(
          (match) => `${page.slug}:${lineOf(page, text, match.index)}`,
        )
      })
    expect(offenders).toEqual([])
  })

  it('writes glossary nouns in lowercase except at the start of a sentence', () => {
    const nameStart = new RegExp(`^(?:${NAMES.join('|')})\\b`, 'u')
    const lineStart = /(?:^|\n)\s*(?:[-*>]|\d+\.|#+|\|)?\s*$/u
    const offenders = pages()
      .filter((page) => !isGenerated(page))
      .flatMap((page) => {
        const text = prose(page.body)
        const found = new Set<string>()
        for (const noun of LOWERCASE_NOUNS) {
          if (page.allowed.has(noun.toLowerCase())) continue
          for (const match of text.matchAll(new RegExp(`\\b${noun}\\b`, 'gu'))) {
            const index = match.index ?? 0
            if (nameStart.test(text.slice(index))) continue
            const before = text.slice(Math.max(0, index - 3), index)
            // A sentence, list item, table cell, heading or label starts here.
            if (index === 0 || lineStart.test(text.slice(Math.max(0, index - 12), index))) continue
            if (/[.!?:"(]\s$|\|\s?$/u.test(before)) continue
            found.add(`${page.slug}:${lineOf(page, text, index)} ${noun}`)
          }
        }
        return [...found]
      })
    expect(offenders).toEqual([])
  })
})
