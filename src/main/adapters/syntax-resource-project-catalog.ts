import type { Dirent } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { SyntaxResourceCatalog, SyntaxResourceScope } from '@shared/types/syntax-resources'
import { emptySyntaxCatalog } from './syntax-resource-import-utils'

const PROJECT_RESOURCE_FILE_LIMIT = 20
const PROJECT_RESOURCE_PARSE_CONCURRENCY = 4
const PROJECT_CATALOG_MAX_BYTES = 8 * 1024 * 1024
const PROJECT_CATALOG_MAX_RESOURCES = 200

export type SyntaxSourceParser = (
  filePath: string,
  scope: SyntaxResourceScope,
) => Promise<SyntaxResourceCatalog>

async function parseProjectResources(
  resourcePaths: readonly string[],
  parseSource: SyntaxSourceParser,
): Promise<readonly SyntaxResourceCatalog[]> {
  const parsedByIndex = new Map<number, SyntaxResourceCatalog>()
  let catalogBytes = 0
  let resourceCount = 0
  function parseChain(index: number): Promise<void> {
    const resourcePath = resourcePaths[index]
    if (!resourcePath) return Promise.resolve()
    return parseSource(resourcePath, 'project')
      .then((parsed) => {
        const nextResourceCount =
          parsed.themes.length + parsed.languages.length + parsed.appearances.length
        const nextBytes = Buffer.byteLength(JSON.stringify(parsed), 'utf8')
        if (
          resourceCount + nextResourceCount > PROJECT_CATALOG_MAX_RESOURCES ||
          catalogBytes + nextBytes > PROJECT_CATALOG_MAX_BYTES
        ) {
          throw new Error('Project syntax resources exceed the aggregate catalog limit.')
        }
        resourceCount += nextResourceCount
        catalogBytes += nextBytes
        parsedByIndex.set(index, parsed)
      })
      .catch(() => {
        // One malformed project resource does not hide the remaining catalog.
      })
      .then(() => parseChain(index + PROJECT_RESOURCE_PARSE_CONCURRENCY))
  }
  await Promise.all(
    Array.from(
      { length: Math.min(PROJECT_RESOURCE_PARSE_CONCURRENCY, resourcePaths.length) },
      (_, index) => parseChain(index),
    ),
  )
  return [...parsedByIndex.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, parsed]) => parsed)
}

export async function readProjectSyntaxCatalog(
  projectPath: string,
  parseSource: SyntaxSourceParser,
) {
  const catalog = emptySyntaxCatalog()
  const projectRoot = await fs.realpath(projectPath)
  const roots = [
    path.join(projectRoot, '.openwaggle', 'themes'),
    path.join(projectRoot, '.openwaggle', 'languages'),
    path.join(projectRoot, '.openwaggle', 'syntax'),
  ]
  const entriesByRoot = await Promise.all(
    roots.map(async (root): Promise<readonly Dirent[]> => {
      try {
        const realRoot = await fs.realpath(root)
        if (realRoot !== path.resolve(root)) return []
        return (await fs.readdir(realRoot, { withFileTypes: true })).filter(
          (entry) => !entry.isSymbolicLink(),
        )
      } catch {
        return []
      }
    }),
  )
  const resourcePaths = entriesByRoot
    .flatMap((entries, rootIndex) =>
      entries.map((entry) => path.join(roots[rootIndex] ?? projectPath, entry.name)),
    )
    .slice(0, PROJECT_RESOURCE_FILE_LIMIT)
  for (const parsed of await parseProjectResources(resourcePaths, parseSource)) {
    catalog.themes.push(...parsed.themes)
    catalog.languages.push(...parsed.languages)
    catalog.appearances.push(...parsed.appearances)
  }
  return catalog
}

export function mergeSyntaxResourceCatalogs(
  global: SyntaxResourceCatalog,
  project: SyntaxResourceCatalog,
) {
  const themes = new Map(global.themes.map((resource) => [resource.id, resource]))
  const languages = new Map(global.languages.map((resource) => [resource.id, resource]))
  const appearances = new Map(global.appearances.map((resource) => [resource.id, resource]))
  for (const resource of project.themes) themes.set(resource.id, resource)
  for (const resource of project.languages) {
    if (!languages.has(resource.id)) languages.set(resource.id, resource)
  }
  for (const resource of project.appearances) appearances.set(resource.id, resource)
  return {
    themes: [...themes.values()],
    languages: [...languages.values()],
    appearances: [...appearances.values()],
  }
}
