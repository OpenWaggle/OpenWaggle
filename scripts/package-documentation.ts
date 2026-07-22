import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  packageDocumentationDefinitions,
  packageDocumentationUrl,
  resolvePackageDocumentationVersions,
  versionPackageDocumentation,
} from './package-documentation-model'
import type {
  VersionedPackageDocumentationDefinition,
} from './package-documentation-model'
import {
  availablePackageDocumentationVersions,
  pendingPackageDocumentationViolations,
  preparePackageDocumentationLine,
} from './package-documentation-lines'
import {
  packageManifest,
  packageManifestDocumentationViolations,
  withPackageDocumentationMetadata,
} from './package-documentation-manifest'
import { parseFrontmatter } from './installed-docs-generator-model'
import { renderApiReference } from './package-api-reference-renderer'
import { renderPackageReadme } from './package-documentation-renderer'

const ARGUMENT_START_INDEX = 2
const FAILURE_EXIT_CODE = 1
const JSON_INDENT_SPACES = 2
interface GeneratedFile {
  readonly contents: string
  readonly path: string
}

interface PackageDocumentationResult {
  readonly changedFiles: readonly string[]
  readonly violations: readonly string[]
}

function isJsonObject(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeMarkdown(value: string) {
  return `${value.replaceAll('\r\n', '\n').trimEnd()}\n`
}

function packageRoot(projectRoot: string, slug: string) {
  return path.join(projectRoot, 'packages', slug)
}

function canonicalGuidePath(projectRoot: string, slug: string, version: string) {
  return path.join(
    projectRoot,
    'website',
    'src',
    'content',
    'docs',
    'packages',
    slug,
    version,
    'index.md',
  )
}

function apiReferencePath(projectRoot: string, slug: string, version: string) {
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

function auxiliaryPagePath(
  projectRoot: string,
  slug: string,
  version: string,
  page: string,
) {
  return path.join(
    projectRoot,
    'website',
    'src',
    'content',
    'docs',
    'packages',
    slug,
    version,
    `${page}.md`,
  )
}

export function requiredAuthoredPackageDocumentationFiles(
  projectRoot: string,
  definition: VersionedPackageDocumentationDefinition,
) {
  return definition.versions.flatMap((version) =>
    definition.pages.flatMap((page) => {
      if (page === 'api-reference' && version === definition.currentVersion) return []
      if (page === 'guide') return [canonicalGuidePath(projectRoot, definition.slug, version)]
      if (page === 'api-reference') {
        return [apiReferencePath(projectRoot, definition.slug, version)]
      }
      return [auxiliaryPagePath(projectRoot, definition.slug, version, page)]
    }),
  )
}

function apiSnapshotPath(projectRoot: string, slug: string) {
  return path.join(projectRoot, 'scripts', 'api-snapshots', `${slug}.api.md`)
}

async function generatedFilesForPackage(
  projectRoot: string,
  definition: VersionedPackageDocumentationDefinition,
) {
  const guidePath = canonicalGuidePath(
    projectRoot,
    definition.slug,
    definition.currentVersion,
  )
  const manifestPath = path.join(packageRoot(projectRoot, definition.slug), 'package.json')
  const [guide, snapshot, rawManifest] = await Promise.all([
    readFile(guidePath, 'utf8'),
    readFile(apiSnapshotPath(projectRoot, definition.slug), 'utf8'),
    readFile(manifestPath, 'utf8'),
  ])
  const manifest = packageManifest(JSON.parse(rawManifest))
  if (manifest.exports === undefined) {
    throw new Error(`${definition.packageName} must declare package exports.`)
  }
  const guideBody = parseFrontmatter(guide).body
  const docsUrl = packageDocumentationUrl(definition.slug, definition.currentVersion)
  return [
    {
      contents: renderPackageReadme({
        canonicalBody: guideBody,
        description: definition.description,
        docsUrl,
        packageName: definition.packageName,
      }),
      path: path.join(packageRoot(projectRoot, definition.slug), 'README.md'),
    },
    {
      contents: renderApiReference({
        apiDescription: definition.apiDescription,
        exports: manifest.exports,
        packageName: definition.packageName,
        snapshot,
        version: definition.currentVersion,
      }),
      path: apiReferencePath(projectRoot, definition.slug, definition.currentVersion),
    },
  ] satisfies readonly GeneratedFile[]
}

async function readIfPresent(filePath: string) {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if (isJsonObject(error) && error.code === 'ENOENT') return undefined
    throw error
  }
}

function relativePath(projectRoot: string, filePath: string) {
  return path.relative(projectRoot, filePath).split(path.sep).join('/')
}

export async function checkPackageDocumentation(
  projectRoot: string,
  update: boolean,
): Promise<PackageDocumentationResult> {
  const changedFiles: string[] = []
  const violations: string[] = []

  for (const baseDefinition of packageDocumentationDefinitions) {
    const definitionRoot = packageRoot(projectRoot, baseDefinition.slug)
    const manifestPath = path.join(definitionRoot, 'package.json')
    const rawManifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'))
    const manifest = packageManifest(rawManifest)
    if (manifest.version === undefined) {
      throw new Error(`${baseDefinition.packageName} package manifest must declare a version.`)
    }

    const historicalVersions = await availablePackageDocumentationVersions(
      projectRoot,
      baseDefinition,
    )
    const resolvedVersions = resolvePackageDocumentationVersions(
      historicalVersions,
      manifest.version,
    )
    violations.push(
      ...(await pendingPackageDocumentationViolations(projectRoot, baseDefinition)),
    )
    if (resolvedVersions.versions.at(-1) !== resolvedVersions.currentVersion) {
      throw new Error(
        `${baseDefinition.packageName} package version ${manifest.version} precedes its latest documentation line.`,
      )
    }
    if (!historicalVersions.includes(resolvedVersions.currentVersion)) {
      if (!update) {
        violations.push(
          `website/src/content/docs/packages/${baseDefinition.slug}/${resolvedVersions.currentVersion} is missing. Run pnpm package-docs:update.`,
        )
        continue
      }
      const prepared = await preparePackageDocumentationLine(
        projectRoot,
        baseDefinition,
        manifest.version,
      )
      changedFiles.push(...prepared.createdFiles)
    }

    const definition = versionPackageDocumentation(baseDefinition, resolvedVersions.versions)
    const docsUrl = packageDocumentationUrl(definition.slug, definition.currentVersion)
    const invalidFields = packageManifestDocumentationViolations(manifest, definition, docsUrl)
    if (invalidFields.length > 0) {
      const outputPath = relativePath(projectRoot, manifestPath)
      if (!update) {
        violations.push(
          `${outputPath} has stale package documentation metadata: ${invalidFields.join(', ')}.`,
        )
      } else {
        await writeFile(
          manifestPath,
          `${JSON.stringify(withPackageDocumentationMetadata(rawManifest, definition, docsUrl), null, JSON_INDENT_SPACES)}\n`,
          'utf8',
        )
        changedFiles.push(outputPath)
      }
    }

    for (const pagePath of requiredAuthoredPackageDocumentationFiles(projectRoot, definition)) {
      if (await readIfPresent(pagePath) === undefined) {
        violations.push(`${relativePath(projectRoot, pagePath)} is missing.`)
      }
    }

    for (const generatedFile of await generatedFilesForPackage(projectRoot, definition)) {
      const expected = normalizeMarkdown(generatedFile.contents)
      const actual = await readIfPresent(generatedFile.path)
      if (actual === expected) continue

      const outputPath = relativePath(projectRoot, generatedFile.path)
      changedFiles.push(outputPath)
      if (!update) {
        violations.push(`${outputPath} is stale. Run pnpm package-docs:update.`)
        continue
      }
      await mkdir(path.dirname(generatedFile.path), { recursive: true })
      await writeFile(generatedFile.path, expected, 'utf8')
    }
  }

  return { changedFiles, violations }
}

async function runCli() {
  const argument = process.argv[ARGUMENT_START_INDEX] ?? '--check'
  if (argument !== '--check' && argument !== '--update') {
    throw new Error(`Unknown package documentation argument: ${argument}`)
  }
  const result = await checkPackageDocumentation(process.cwd(), argument === '--update')
  for (const violation of result.violations) console.error(violation)
  if (result.violations.length > 0) process.exitCode = FAILURE_EXIT_CODE
  if (result.changedFiles.length === 0) {
    console.log('Package documentation is current.')
    return
  }
  if (argument !== '--update') return
  for (const changedFile of result.changedFiles) console.log(`Updated ${changedFile}.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runCli()
}

export { preparePackageDocumentationLine } from './package-documentation-lines'
