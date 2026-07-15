import { execFile as execFileCallback } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

import {
  assertDualModuleExports,
  assertPackedPackageFiles,
  assertPackedPackageMetadata,
} from './package-smoke-assertions'
import {
  assertPackedDocumentationMetadata,
  assertPackedPackageReadme,
} from './package-smoke-documentation-assertions'
import {
  assertNoWorkspaceProtocols,
  assertReactPeerDependencies,
} from './package-smoke-runtime-assertions'
import type { PackedPackageReference } from './package-smoke-canonical'

const execFile = promisify(execFileCallback)
const EXEC_MAX_BUFFER_BYTES = 10_000_000
const PACKAGE_TARBALL_PREFIX = 'package/'

export interface PackageSpec {
  readonly name: string
  readonly directory: string
}

export interface PackedPackage extends PackedPackageReference {
  readonly manifest: unknown
}

async function readPackedManifest(tarballPath: string) {
  const result = await execFile(
    'tar',
    ['-xOf', tarballPath, `${PACKAGE_TARBALL_PREFIX}package.json`],
    { maxBuffer: EXEC_MAX_BUFFER_BYTES },
  )
  const parsed: unknown = JSON.parse(result.stdout)
  return parsed
}

async function readPackedTextFile(tarballPath: string, relativePath: string) {
  const result = await execFile(
    'tar',
    ['-xOf', tarballPath, `${PACKAGE_TARBALL_PREFIX}${relativePath}`],
    { maxBuffer: EXEC_MAX_BUFFER_BYTES },
  )
  return result.stdout
}

async function listTarballPackageFiles(tarballPath: string) {
  const result = await execFile('tar', ['-tf', tarballPath], {
    maxBuffer: EXEC_MAX_BUFFER_BYTES,
  })
  return result.stdout
    .split('\n')
    .filter((entry) => entry.startsWith(PACKAGE_TARBALL_PREFIX))
    .map((entry) => entry.slice(PACKAGE_TARBALL_PREFIX.length))
    .filter((entry) => entry.length > 0)
}

export async function validatePackedPackage(
  spec: PackageSpec,
  tarballPath: string,
): Promise<PackedPackage> {
  const manifest = await readPackedManifest(tarballPath)
  const readme = await readPackedTextFile(tarballPath, 'README.md')
  const files = await listTarballPackageFiles(tarballPath)

  assertPackedPackageFiles({ packageName: spec.name, manifest, files })
  assertNoWorkspaceProtocols(spec.name, manifest)
  assertPackedPackageMetadata(manifest, spec.directory)
  assertPackedDocumentationMetadata(manifest, spec.directory)
  assertPackedPackageReadme({ packageName: spec.name, readme })
  assertDualModuleExports(spec.name, manifest)
  if (spec.name === '@openwaggle/extension-react') assertReactPeerDependencies(manifest)

  console.log(`validated ${spec.name} tarball: ${path.basename(tarballPath)}`)
  return { name: spec.name, tarballPath, manifest }
}
