import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import path from 'node:path'

export const DOCS_SCHEMA_VERSION = 1
export const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx'])
export const ROOT_README_TOPIC_LIMIT = 8
export const JSON_INDENT = 2
export const INDEX_FILE = 'index.json'
export const WEBSITE_DOCS_ROOT = 'website/src/content/docs'
export const PI_DOCS_ROOT = 'node_modules/@earendil-works/pi-coding-agent/docs'
export const OUTPUT_ROOT = 'build/openwaggle-docs'
export const OPENWAGGLE_GROUP = {
  id: 'openwaggle',
  title: 'OpenWaggle Docs',
  description: 'First-party OpenWaggle user and developer documentation.',
} as const
export const PI_GROUP = {
  id: 'pi',
  title: 'Pi Docs',
  description: 'Installed Pi coding-agent documentation bundled with OpenWaggle.',
} as const

const TOPIC_ID_SEPARATOR = ':'
const FRONTMATTER_DELIMITER = '---'
const WORD_MIN_LENGTH = 3
const HASH_ALGORITHM = 'sha256'
const HASH_ENCODING = 'hex'
const FRONTMATTER_MAX_SPLIT_PARTS = 2

interface FrontmatterResult {
  readonly fields: ReadonlyMap<string, string>
  readonly body: string
}

export interface InstalledDocTopic {
  readonly topic: string
  readonly source: typeof OPENWAGGLE_GROUP.id | typeof PI_GROUP.id
  readonly group: string
  readonly title: string
  readonly description?: string
  readonly section?: string
  readonly order: number
  readonly sourcePath: string
  readonly bundlePath: string
  readonly aliases: readonly string[]
  readonly keywords: readonly string[]
  readonly contentHash: string
}

export interface InstalledDocsManifest {
  readonly schemaVersion: typeof DOCS_SCHEMA_VERSION
  readonly generatedAt: string
  readonly readmePath: string
  readonly groups: readonly [typeof OPENWAGGLE_GROUP, typeof PI_GROUP]
  readonly topics: readonly InstalledDocTopic[]
}

export function topicId(group: string, slug: string) {
  return `${group}${TOPIC_ID_SEPARATOR}${slug}`
}

export function posixPath(value: string) {
  return value.split(path.sep).join(path.posix.sep)
}

export function withoutMarkdownExtension(relativePath: string) {
  const extension = path.extname(relativePath)
  return posixPath(relativePath.slice(0, -extension.length))
}

export function markdownOutputPath(group: string, slug: string) {
  return posixPath(path.join('topics', group, `${slug}.md`))
}

export function hashContent(content: string | Buffer) {
  return createHash(HASH_ALGORITHM).update(content).digest(HASH_ENCODING)
}

function parseFrontmatterFields(frontmatter: string) {
  const fields = new Map<string, string>()
  for (const line of frontmatter.split('\n')) {
    const [key, rawValue] = line.split(':', FRONTMATTER_MAX_SPLIT_PARTS)
    if (!key || rawValue === undefined) {
      continue
    }
    fields.set(key.trim(), rawValue.trim().replace(/^['"]|['"]$/g, ''))
  }
  return fields
}

export function parseFrontmatter(content: string): FrontmatterResult {
  const normalized = content.replaceAll('\r\n', '\n')
  if (!normalized.startsWith(`${FRONTMATTER_DELIMITER}\n`)) {
    return { fields: new Map(), body: normalized }
  }

  const closing = `\n${FRONTMATTER_DELIMITER}\n`
  const closingIndex = normalized.indexOf(closing, FRONTMATTER_DELIMITER.length)
  if (closingIndex === -1) {
    return { fields: new Map(), body: normalized }
  }

  const frontmatter = normalized.slice(FRONTMATTER_DELIMITER.length + 1, closingIndex)
  const body = normalized.slice(closingIndex + closing.length)
  return { fields: parseFrontmatterFields(frontmatter), body }
}

export function firstHeading(body: string) {
  const heading = body
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('# '))
  return heading ? heading.slice('# '.length).trim() : null
}

export function titleFromSlug(slug: string) {
  const basename = slug.split('/').at(-1) ?? slug
  return basename
    .split('-')
    .filter((part) => part.length > 0)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function wordsFrom(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= WORD_MIN_LENGTH)
}

function unique(values: readonly string[]) {
  const result: string[] = []
  for (const value of values) {
    if (value.length > 0 && !result.includes(value)) {
      result.push(value)
    }
  }
  return result
}

export function aliasesFor(input: {
  readonly slug: string
  readonly title: string
  readonly section: string | undefined
  readonly source: InstalledDocTopic['source']
}) {
  const basename = input.slug.split('/').at(-1) ?? input.slug
  return unique([
    input.slug,
    basename,
    input.title.toLowerCase(),
    `${input.source}/${input.slug}`,
    ...(input.section ? [input.section.toLowerCase()] : []),
  ])
}

export function keywordsFor(input: {
  readonly slug: string
  readonly title: string
  readonly description: string | undefined
  readonly section: string | undefined
}) {
  return unique([
    ...wordsFrom(input.slug),
    ...wordsFrom(input.title),
    ...wordsFrom(input.description ?? ''),
    ...wordsFrom(input.section ?? ''),
  ])
}

export function docsOrder(slug: string) {
  return slug.length
}

export async function listFiles(rootPath: string) {
  const result: string[] = []
  async function visit(directoryPath: string) {
    const entries = await readdir(directoryPath, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(directoryPath, entry.name)
      if (entry.isDirectory()) {
        await visit(entryPath)
        continue
      }
      if (entry.isFile()) {
        result.push(entryPath)
      }
    }
  }
  await visit(rootPath)
  return result.sort((left, right) => left.localeCompare(right))
}
