import { access, copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  resolvePackageDocumentationVersions,
} from './package-documentation-model'
import type {
  PackageDocumentationDefinition,
  PackageDocumentationPage,
} from './package-documentation-model'

function documentationRoot(
  projectRoot: string,
  definition: PackageDocumentationDefinition,
) {
  return path.join(
    projectRoot,
    'website',
    'src',
    'content',
    'docs',
    'packages',
    definition.slug,
  )
}

function pendingDocumentationRoot(
  projectRoot: string,
  definition: PackageDocumentationDefinition,
) {
  return path.join(
    projectRoot,
    'website',
    'src',
    'content',
    'package-docs-next',
    definition.slug,
  )
}

function authoredPagePath(
  projectRoot: string,
  definition: PackageDocumentationDefinition,
  version: string,
  page: Exclude<PackageDocumentationPage, 'api-reference'>,
) {
  return path.join(
    documentationRoot(projectRoot, definition),
    version,
    page === 'guide' ? 'index.md' : `${page}.md`,
  )
}

function pendingAuthoredPagePath(
  projectRoot: string,
  definition: PackageDocumentationDefinition,
  page: Exclude<PackageDocumentationPage, 'api-reference'>,
) {
  return path.join(
    pendingDocumentationRoot(projectRoot, definition),
    page === 'guide' ? 'index.md' : `${page}.md`,
  )
}

function relativePath(projectRoot: string, filePath: string) {
  return path.relative(projectRoot, filePath).split(path.sep).join('/')
}

export async function availablePackageDocumentationVersions(
  projectRoot: string,
  definition: PackageDocumentationDefinition,
) {
  const entries = await readdir(documentationRoot(projectRoot, definition), {
    withFileTypes: true,
  })
  return entries
    .filter((entry) => entry.isDirectory() && /^\d+\.\d+$/u.test(entry.name))
    .map((entry) => entry.name)
}

async function exists(filePath: string) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

export async function pendingPackageDocumentationViolations(
  projectRoot: string,
  definition: PackageDocumentationDefinition,
) {
  const pendingRoot = pendingDocumentationRoot(projectRoot, definition)
  if (!(await exists(pendingRoot))) return []

  const violations: string[] = []
  for (const page of definition.pages) {
    if (page === 'api-reference') continue
    const pagePath = pendingAuthoredPagePath(projectRoot, definition, page)
    if (!(await exists(pagePath))) {
      violations.push(`${relativePath(projectRoot, pagePath)} is missing.`)
    }
  }
  return violations
}

export async function preparePackageDocumentationLine(
  projectRoot: string,
  definition: PackageDocumentationDefinition,
  packageVersion: string,
) {
  const historicalVersions = await availablePackageDocumentationVersions(projectRoot, definition)
  const resolved = resolvePackageDocumentationVersions(historicalVersions, packageVersion)
  const latestVersion = resolved.versions.at(-1)
  if (latestVersion !== resolved.currentVersion) {
    throw new Error(
      `${definition.packageName} package version ${packageVersion} precedes the latest ${latestVersion} documentation line.`,
    )
  }
  if (historicalVersions.includes(resolved.currentVersion)) {
    return { createdFiles: [], ...resolved }
  }

  const pendingViolations = await pendingPackageDocumentationViolations(projectRoot, definition)
  if (pendingViolations.length > 0) {
    throw new Error(
      `${definition.packageName} pending documentation is incomplete: ${pendingViolations.join(' ')}`,
    )
  }
  const pendingRoot = pendingDocumentationRoot(projectRoot, definition)
  if (!(await exists(pendingRoot))) {
    throw new Error(
      `${definition.packageName} requires authored pending documentation in ${relativePath(projectRoot, pendingRoot)} before opening ${resolved.currentVersion}.`,
    )
  }

  const createdFiles: string[] = []
  for (const page of definition.pages) {
    if (page === 'api-reference') continue
    const sourcePath = pendingAuthoredPagePath(projectRoot, definition, page)
    const targetPath = authoredPagePath(projectRoot, definition, resolved.currentVersion, page)
    await mkdir(path.dirname(targetPath), { recursive: true })
    await copyFile(sourcePath, targetPath)
    createdFiles.push(relativePath(projectRoot, targetPath))
  }
  await rm(pendingRoot, { force: true, recursive: true })
  return { createdFiles, ...resolved }
}
