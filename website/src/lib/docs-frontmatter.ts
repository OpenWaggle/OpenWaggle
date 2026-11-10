import { z } from 'astro/zod'

// The docs collection's frontmatter parser and schema. `content.config.ts` loads every page in
// `src/content/docs/` with them, and the unit tests check the pending package lines in
// `src/content/package-docs-next/` with the same two, so a page that would fail the website build
// after Release Please promotes it fails on the pull request instead.

const DEFAULT_DOC_ORDER = 999
const FRONTMATTER_OPEN_MARKER = '---\n'
const FRONTMATTER_CLOSE_MARKER = '\n---\n'

export interface ParsedMarkdownFile {
  readonly data: Record<string, unknown>
  readonly content: string
}

function parseFrontmatterValue(rawValue: string) {
  const value = rawValue.trim()
  if (/^-?\d+(?:\.\d+)?$/u.test(value)) {
    return Number(value)
  }
  if (value === 'true') {
    return true
  }
  if (value === 'false') {
    return false
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

export function parseMarkdownFrontmatter(source: string): ParsedMarkdownFile {
  const normalizedSource = source.replaceAll('\r\n', '\n')
  if (!normalizedSource.startsWith(FRONTMATTER_OPEN_MARKER)) {
    return { data: {}, content: normalizedSource }
  }

  const closingMarkerIndex = normalizedSource.indexOf(
    FRONTMATTER_CLOSE_MARKER,
    FRONTMATTER_OPEN_MARKER.length,
  )
  if (closingMarkerIndex < 0) {
    return { data: {}, content: normalizedSource }
  }

  const frontmatter = normalizedSource.slice(FRONTMATTER_OPEN_MARKER.length, closingMarkerIndex)
  const content = normalizedSource.slice(closingMarkerIndex + FRONTMATTER_CLOSE_MARKER.length)
  const data: Record<string, unknown> = {}

  for (const line of frontmatter.split('\n')) {
    const separatorIndex = line.indexOf(':')
    if (separatorIndex < 0) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    if (!key) {
      continue
    }

    data[key] = parseFrontmatterValue(line.slice(separatorIndex + 1))
  }

  return { data, content }
}

export const docsFrontmatterSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  order: z.number().default(DEFAULT_DOC_ORDER),
  section: z.string(),
  // ADR 0061: a guide teaches one task, a reference page lists exact facts, an overview explains the model.
  kind: z.enum(['guide', 'reference', 'overview']),
  // Other names readers and agents search for, comma-separated; the installed docs index them.
  aliases: z.string().optional(),
})
