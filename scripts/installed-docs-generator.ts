import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  aliasesFor,
  DOCS_SCHEMA_VERSION,
  docsOrder,
  firstHeading,
  hashContent,
  INDEX_FILE,
  type InstalledDocsManifest,
  type InstalledDocTopic,
  JSON_INDENT,
  keywordsFor,
  listFiles,
  MARKDOWN_EXTENSIONS,
  markdownOutputPath,
  OPENWAGGLE_GROUP,
  OUTPUT_ROOT,
  parseFrontmatter,
  PI_DOCS_ROOT,
  PI_GROUP,
  posixPath,
  ROOT_README_TOPIC_LIMIT,
  titleFromSlug,
  topicId,
  WEBSITE_DOCS_ROOT,
  withoutMarkdownExtension,
} from './installed-docs-generator-model'
import { renderPackageInstallElements } from './package-documentation-renderer'

interface GenerateInstalledDocsOptions {
  readonly outputRoot?: string
  readonly generatedAt?: string
}

async function copyPiAssets(piRoot: string, outputRoot: string) {
  const files = await listFiles(piRoot)
  for (const filePath of files) {
    const relativePath = posixPath(path.relative(piRoot, filePath))
    if (MARKDOWN_EXTENSIONS.has(path.extname(relativePath))) {
      continue
    }
    const outputPath = path.join(outputRoot, 'topics', PI_GROUP.id, relativePath)
    await mkdir(path.dirname(outputPath), { recursive: true })
    await copyFile(filePath, outputPath)
  }
}

function compareTopics(left: InstalledDocTopic, right: InstalledDocTopic) {
  const sourceComparison = left.source.localeCompare(right.source)
  if (sourceComparison !== 0) {
    return sourceComparison
  }
  const sectionComparison = (left.section ?? '').localeCompare(right.section ?? '')
  if (sectionComparison !== 0) {
    return sectionComparison
  }
  const orderComparison = left.order - right.order
  return orderComparison !== 0 ? orderComparison : left.topic.localeCompare(right.topic)
}

async function writeTopicFile(outputRoot: string, bundlePath: string, rawContent: string) {
  const outputPath = path.join(outputRoot, bundlePath)
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, rawContent, 'utf8')
}

async function buildOpenWaggleTopics(outputRoot: string) {
  const rootPath = path.resolve(WEBSITE_DOCS_ROOT)
  const files = (await listFiles(rootPath)).filter((filePath) =>
    MARKDOWN_EXTENSIONS.has(path.extname(filePath)),
  )
  const topics: InstalledDocTopic[] = []

  for (const filePath of files) {
    const relativePath = posixPath(path.relative(rootPath, filePath))
    const slug = withoutMarkdownExtension(relativePath)
    const rawContent = await readFile(filePath, 'utf8')
    const installedContent = renderPackageInstallElements(rawContent)
    const parsed = parseFrontmatter(installedContent)
    const title = parsed.fields.get('title') ?? titleFromSlug(slug)
    const description = parsed.fields.get('description')
    const section = parsed.fields.get('section')
    const order = Number(parsed.fields.get('order') ?? docsOrder(slug))
    const bundlePath = markdownOutputPath(OPENWAGGLE_GROUP.id, slug)

    topics.push({
      topic: topicId(OPENWAGGLE_GROUP.id, slug),
      source: OPENWAGGLE_GROUP.id,
      group: OPENWAGGLE_GROUP.title,
      title,
      ...(description ? { description } : {}),
      ...(section ? { section } : {}),
      order,
      sourcePath: posixPath(path.relative(process.cwd(), filePath)),
      bundlePath,
      aliases: aliasesFor({ slug, title, section, source: OPENWAGGLE_GROUP.id }),
      keywords: keywordsFor({ slug, title, description, section }),
      contentHash: hashContent(installedContent),
    })
    await writeTopicFile(outputRoot, bundlePath, installedContent)
  }

  return topics.sort(compareTopics)
}

async function buildPiTopics(outputRoot: string) {
  const rootPath = path.resolve(PI_DOCS_ROOT)
  const files = (await listFiles(rootPath)).filter((filePath) =>
    MARKDOWN_EXTENSIONS.has(path.extname(filePath)),
  )
  const topics: InstalledDocTopic[] = []

  for (const filePath of files) {
    const relativePath = posixPath(path.relative(rootPath, filePath))
    const slug = withoutMarkdownExtension(relativePath)
    const rawContent = await readFile(filePath, 'utf8')
    const parsed = parseFrontmatter(rawContent)
    const title = parsed.fields.get('title') ?? firstHeading(parsed.body) ?? titleFromSlug(slug)
    const description = parsed.fields.get('description')
    const section = 'Pi'
    const bundlePath = markdownOutputPath(PI_GROUP.id, slug)

    topics.push({
      topic: topicId(PI_GROUP.id, slug),
      source: PI_GROUP.id,
      group: PI_GROUP.title,
      title,
      ...(description ? { description } : {}),
      section,
      order: docsOrder(slug),
      sourcePath: posixPath(path.relative(process.cwd(), filePath)),
      bundlePath,
      aliases: aliasesFor({ slug, title, section, source: PI_GROUP.id }),
      keywords: keywordsFor({ slug, title, description, section }),
      contentHash: hashContent(rawContent),
    })
    await writeTopicFile(outputRoot, bundlePath, rawContent)
  }

  await copyPiAssets(rootPath, outputRoot)
  return topics.sort(compareTopics)
}

function readmeForGroup(
  group: typeof OPENWAGGLE_GROUP | typeof PI_GROUP,
  topics: readonly InstalledDocTopic[],
) {
  const lines = [`# ${group.title}`, '', group.description, '']
  for (const topic of topics) {
    const relativePath = path.posix.relative(`topics/${group.id}`, topic.bundlePath)
    lines.push(`- [${topic.title}](./${relativePath})`)
  }
  lines.push('')
  return lines.join('\n')
}

function rootReadme(manifest: InstalledDocsManifest) {
  const lines = [
    '# OpenWaggle Installed Docs',
    '',
    'This bundle is generated from `website/src/content/docs/**` and installed Pi package docs.',
    'Agents should discover paths and metadata through the typed OpenWaggle docs API instead of assuming source-tree paths.',
    '',
  ]

  for (const group of manifest.groups) {
    const groupTopics = manifest.topics.filter((topic) => topic.source === group.id)
    lines.push(`## ${group.title}`, '')
    for (const topic of groupTopics.slice(0, ROOT_README_TOPIC_LIMIT)) {
      lines.push(`- \`${topic.topic}\`: [${topic.title}](${topic.bundlePath})`)
    }
    if (groupTopics.length > ROOT_README_TOPIC_LIMIT) {
      lines.push(`- ${groupTopics.length - ROOT_README_TOPIC_LIMIT} more topics in ${INDEX_FILE}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

export async function generateInstalledDocs(options: GenerateInstalledDocsOptions = {}) {
  const outputRoot = options.outputRoot ?? OUTPUT_ROOT

  await rm(outputRoot, { force: true, recursive: true })
  await mkdir(outputRoot, { recursive: true })

  const openWaggleTopics = await buildOpenWaggleTopics(outputRoot)
  const piTopics = await buildPiTopics(outputRoot)
  const topics = [...openWaggleTopics, ...piTopics].sort(compareTopics)
  const manifest: InstalledDocsManifest = {
    schemaVersion: DOCS_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    readmePath: 'README.md',
    groups: [OPENWAGGLE_GROUP, PI_GROUP],
    topics,
  }

  await writeFile(path.join(outputRoot, INDEX_FILE), `${JSON.stringify(manifest, null, JSON_INDENT)}\n`)
  await writeFile(path.join(outputRoot, 'README.md'), rootReadme(manifest), 'utf8')
  await mkdir(path.join(outputRoot, 'topics', OPENWAGGLE_GROUP.id), { recursive: true })
  await mkdir(path.join(outputRoot, 'topics', PI_GROUP.id), { recursive: true })
  await writeFile(
    path.join(outputRoot, 'topics', OPENWAGGLE_GROUP.id, 'README.md'),
    readmeForGroup(OPENWAGGLE_GROUP, openWaggleTopics),
    'utf8',
  )
  await writeFile(
    path.join(outputRoot, 'topics', PI_GROUP.id, 'README.md'),
    readmeForGroup(PI_GROUP, piTopics),
    'utf8',
  )
}
