import fs from 'node:fs/promises'
import path from 'node:path'
import {
  findPackageDependencyVersion,
  resolvePackageSmokeCatalogVersion,
  type WorkspaceCatalogs,
} from './package-smoke-runtime-assertions'
import { parseRootWorkspaceConfig } from './support/bun-workspace'

/**
 * The versions the consumer smoke project installs from the registry, read from the repository's
 * own manifests and the catalogs under `workspaces` in the root package.json.
 */

async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

/** Pins for registry packages the consumer smoke installs that the repository itself does not use. */
const CONSUMER_SMOKE_CATALOG = 'package-consumer-smoke'

export async function readWorkspaceCatalogs(projectRoot: string) {
  return parseRootWorkspaceConfig(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'))
    .catalogs
}

export async function smokeDependencyVersion(
  projectRoot: string,
  dependencyName: string,
  catalogs: WorkspaceCatalogs,
) {
  const manifests = [
    await readJsonFile(path.join(projectRoot, 'package.json')),
    await readJsonFile(path.join(projectRoot, 'packages/pi-waggle/package.json')),
  ]

  for (const manifest of manifests) {
    const version = findPackageDependencyVersion(manifest, dependencyName)
    if (version) return resolvePackageSmokeCatalogVersion(version, dependencyName, catalogs)
  }
  const consumerPin = catalogs[CONSUMER_SMOKE_CATALOG]?.[dependencyName]
  if (consumerPin) return consumerPin

  throw new Error(`Cannot find smoke dependency version for ${dependencyName}.`)
}
