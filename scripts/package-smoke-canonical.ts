import fs from 'node:fs/promises'
import path from 'node:path'

import { decodePackageReleaseArtifactManifest } from './package-release-artifact-contract'

const EXPECTED_TARBALL_ARGUMENT_COUNT = 2

export interface PackedPackageReference {
  readonly name: string
  readonly tarballPath: string
}

export function mergePackedPackageSources<T extends PackedPackageReference>(
  generated: readonly T[],
  canonical: readonly T[],
) {
  const canonicalByName = new Map<string, T>()
  for (const packedPackage of canonical) {
    if (canonicalByName.has(packedPackage.name)) {
      throw new Error(`Canonical package smoke contains duplicate ${packedPackage.name} tarballs.`)
    }
    canonicalByName.set(packedPackage.name, packedPackage)
  }
  return generated.map((packedPackage) => canonicalByName.get(packedPackage.name) ?? packedPackage)
}

export function parsePackageSmokeArgs(args: readonly string[]) {
  if (args.length === 0) return {}
  const [flag, tarballDirectory] = args
  if (
    args.length !== EXPECTED_TARBALL_ARGUMENT_COUNT ||
    flag !== '--tarball-dir' ||
    tarballDirectory === undefined
  ) {
    throw new Error('Usage: package-smoke.ts [--tarball-dir <absolute-directory>].')
  }
  if (!path.isAbsolute(tarballDirectory)) {
    throw new Error('Package smoke tarball directory must be absolute.')
  }
  return { tarballDirectory }
}

export async function readCanonicalPackageTarballs(
  tarballDirectory: string,
  packageNames: ReadonlySet<string>,
) {
  const canonicalRoot = await fs.realpath(tarballDirectory)
  const manifest = decodePackageReleaseArtifactManifest(
    JSON.parse(await fs.readFile(path.join(canonicalRoot, 'release-artifacts.json'), 'utf8')),
  )
  if (manifest.packages.length === 0) {
    throw new Error('Canonical package smoke requires at least one release tarball.')
  }
  return Promise.all(
    manifest.packages.map(async (artifact) => {
      if (!packageNames.has(artifact.name)) {
        throw new Error(`Canonical package smoke contains unknown package ${artifact.name}.`)
      }
      const tarballPath = await fs.realpath(path.join(canonicalRoot, artifact.file))
      if (path.dirname(tarballPath) !== canonicalRoot) {
        throw new Error(`${artifact.name} canonical tarball escaped its artifact directory.`)
      }
      return { name: artifact.name, tarballPath }
    }),
  )
}
