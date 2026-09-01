import type { Dirent } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { SyntaxResourceCatalog, SyntaxResourceScope } from '@shared/types/syntax-resources'
import { isEnoent } from '@shared/utils/node-error'
import {
  chargeSyntaxReadBudget,
  createSyntaxReadBudget,
  emptySyntaxCatalog,
  type SyntaxReadBudget,
} from './syntax-resource-import-utils'
import { SyntaxSourceValidationError } from './syntax-source-errors'

const PROJECT_RESOURCE_FILE_LIMIT = 20
const PROJECT_RESOURCE_PARSE_CONCURRENCY = 4
export const PROJECT_CATALOG_MAX_BYTES = 8 * 1024 * 1024
const PROJECT_CATALOG_MAX_INPUT_ENTRIES = 1_000
const PROJECT_CATALOG_MAX_INPUT_DEPTH = 64
const PROJECT_CATALOG_MAX_RESOURCES = 200

export type SyntaxSourceParser = (
  filePath: string,
  scope: SyntaxResourceScope,
  readBudget?: SyntaxReadBudget,
) => Promise<SyntaxResourceCatalog>

interface ProjectResourceInputBudget {
  readonly readBudget: SyntaxReadBudget
  remainingEntries: number
}

function exceedsConfinementRoot(candidatePath: string, confinementRoot: string) {
  const relative = path.relative(confinementRoot, candidatePath)
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
}

async function chargeProjectResourceInput(
  resourcePath: string,
  budget: ProjectResourceInputBudget,
  confinementRoot?: string,
  depth = 0,
): Promise<void> {
  if (depth > PROJECT_CATALOG_MAX_INPUT_DEPTH) {
    throw new Error('Project syntax resource inputs exceed the aggregate depth limit.')
  }
  if (budget.remainingEntries <= 0) {
    throw new Error('Project syntax resource inputs exceed the aggregate entry limit.')
  }
  budget.remainingEntries -= 1
  const stats = await fs.lstat(resourcePath)
  if (stats.isSymbolicLink()) return
  if (stats.isFile()) {
    chargeSyntaxReadBudget(budget.readBudget, stats.size)
    return
  }
  if (!stats.isDirectory()) return
  const realDirectory = await fs.realpath(resourcePath)
  const nextConfinementRoot = confinementRoot ?? realDirectory
  if (exceedsConfinementRoot(realDirectory, nextConfinementRoot)) return
  const directory = await fs.opendir(realDirectory)
  for await (const entry of directory) {
    if (entry.isSymbolicLink()) continue
    await chargeProjectResourceInput(
      path.join(realDirectory, entry.name),
      budget,
      nextConfinementRoot,
      depth + 1,
    )
  }
}

async function assertProjectResourceInputCapacity(
  resourcePaths: readonly string[],
  readBudget: SyntaxReadBudget,
) {
  const budget = {
    readBudget,
    remainingEntries: PROJECT_CATALOG_MAX_INPUT_ENTRIES,
  }
  for (const resourcePath of resourcePaths) {
    await chargeProjectResourceInput(resourcePath, budget)
  }
}

async function readProjectResourceRoot(root: string): Promise<readonly Dirent[]> {
  try {
    const realRoot = await fs.realpath(root)
    if (realRoot !== path.resolve(root)) return []
    return (await fs.readdir(realRoot, { withFileTypes: true }))
      .filter((entry) => !entry.isSymbolicLink())
      .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
  } catch (error) {
    if (isEnoent(error)) return []
    throw error
  }
}

async function parseProjectResources(
  resourcePaths: readonly string[],
  parseSource: SyntaxSourceParser,
  readBudget: SyntaxReadBudget,
): Promise<readonly SyntaxResourceCatalog[]> {
  const parsedByIndex = new Map<number, SyntaxResourceCatalog>()
  let catalogBytes = 0
  let resourceCount = 0
  let stopped = false
  async function parseChain(index: number): Promise<void> {
    if (stopped) return
    const resourcePath = resourcePaths[index]
    if (!resourcePath) return
    let parsed: SyntaxResourceCatalog
    try {
      parsed = await parseSource(resourcePath, 'project', readBudget)
    } catch (error) {
      if (!(error instanceof SyntaxSourceValidationError)) {
        stopped = true
        throw error
      }
      // One malformed project resource does not hide the remaining catalog.
      await parseChain(index + PROJECT_RESOURCE_PARSE_CONCURRENCY)
      return
    }
    if (stopped) return
    const nextResourceCount =
      parsed.themes.length + parsed.languages.length + parsed.appearances.length
    const nextBytes = Buffer.byteLength(JSON.stringify(parsed), 'utf8')
    if (
      resourceCount + nextResourceCount > PROJECT_CATALOG_MAX_RESOURCES ||
      catalogBytes + nextBytes > PROJECT_CATALOG_MAX_BYTES
    ) {
      stopped = true
      throw new Error('Project syntax resources exceed the aggregate catalog limit.')
    }
    resourceCount += nextResourceCount
    catalogBytes += nextBytes
    parsedByIndex.set(index, parsed)
    await parseChain(index + PROJECT_RESOURCE_PARSE_CONCURRENCY)
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
  const entriesByRoot = await Promise.all(roots.map(readProjectResourceRoot))
  const resourcePaths = entriesByRoot.flatMap((entries, rootIndex) =>
    entries.map((entry) => path.join(roots[rootIndex] ?? projectPath, entry.name)),
  )
  if (resourcePaths.length > PROJECT_RESOURCE_FILE_LIMIT) {
    throw new Error('The project syntax resource library exceeds its supported limit.')
  }
  const preflightBudget = createSyntaxReadBudget(
    PROJECT_CATALOG_MAX_BYTES,
    'Project syntax resource inputs exceed the aggregate byte limit.',
  )
  await assertProjectResourceInputCapacity(resourcePaths, preflightBudget)
  const readBudget = createSyntaxReadBudget(
    PROJECT_CATALOG_MAX_BYTES,
    'Project syntax resource reads exceed the aggregate byte limit.',
  )
  for (const parsed of await parseProjectResources(resourcePaths, parseSource, readBudget)) {
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
