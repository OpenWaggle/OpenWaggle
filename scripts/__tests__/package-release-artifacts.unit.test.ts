import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { verifyReleaseArtifactBundle } from '../package-release-artifacts'
import type { PackageReleasePlan } from '../package-release-plan'

const temporaryDirectories: string[] = []

function run(command: string, args: readonly string[]) {
  return new Promise<void>((resolve, reject) => {
    execFile(command, args, (error) => (error === null ? resolve() : reject(error)))
  })
}

async function createArtifactBundle() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'openwaggle-release-artifact-'))
  temporaryDirectories.push(root)
  const packageRoot = path.join(root, 'source', 'package')
  const artifactRoot = path.join(root, 'artifacts')
  await mkdir(path.join(packageRoot, 'dist'), { recursive: true })
  await mkdir(artifactRoot, { recursive: true })
  await Promise.all([
    writeFile(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({
        name: '@openwaggle/extension-sdk',
        publishConfig: { access: 'public' },
        repository: { url: 'https://github.com/OpenWaggle/OpenWaggle.git' },
        version: '0.1.1',
      }),
    ),
    writeFile(path.join(packageRoot, 'README.md'), '# SDK\n'),
    writeFile(path.join(packageRoot, 'CHANGELOG.md'), '# Changelog\n'),
    writeFile(path.join(packageRoot, 'LICENSE'), 'MIT\n'),
    writeFile(path.join(packageRoot, 'dist', 'index.js'), 'export {}\n'),
  ])
  const tarball = 'openwaggle-extension-sdk-0.1.1.tgz'
  await run('tar', ['-czf', path.join(artifactRoot, tarball), '-C', path.join(root, 'source'), 'package'])
  const contents = await readFile(path.join(artifactRoot, tarball))
  const plan: PackageReleasePlan = {
    packages: [
      {
        key: 'extension-sdk',
        name: '@openwaggle/extension-sdk',
        packagePath: 'packages/extension-sdk',
        tag: 'extension-sdk-v0.1.1',
        version: '0.1.1',
      },
    ],
    schemaVersion: 1,
    sourceSha: 'source-sha',
    sourceTree: 'source-tree',
  }
  await writeFile(
    path.join(artifactRoot, 'release-artifacts.json'),
    `${JSON.stringify({
      packages: [
        {
          file: tarball,
          integrity: `sha512-${createHash('sha512').update(contents).digest('base64')}`,
          key: 'extension-sdk',
          name: '@openwaggle/extension-sdk',
          releaseNotes: 'SDK notes',
          sha256: createHash('sha256').update(contents).digest('hex'),
          tag: 'extension-sdk-v0.1.1',
          version: '0.1.1',
        },
      ],
      schemaVersion: 1,
      sourceSha: 'source-sha',
      sourceTree: 'source-tree',
    }, null, 2)}\n`,
  )
  return { artifactRoot, plan, tarball }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  )
})

describe('package release artifacts', () => {
  it('accepts an exact, hashed tarball bundle for the source tree plan', async () => {
    const { artifactRoot, plan } = await createArtifactBundle()

    const manifest = await verifyReleaseArtifactBundle(plan, artifactRoot)

    expect(manifest.sourceTree).toBe('source-tree')
    expect(manifest.packages.map(({ name }) => name)).toEqual(['@openwaggle/extension-sdk'])
  })

  it('rejects artifact hash or source-tree substitution', async () => {
    const { artifactRoot, plan, tarball } = await createArtifactBundle()
    await writeFile(path.join(artifactRoot, tarball), 'substituted')

    await expect(verifyReleaseArtifactBundle(plan, artifactRoot)).rejects.toThrow('SHA-256')

    const fresh = await createArtifactBundle()
    await expect(
      verifyReleaseArtifactBundle({ ...fresh.plan, sourceTree: 'different-tree' }, fresh.artifactRoot),
    ).rejects.toThrow('source identity')
  })
})
